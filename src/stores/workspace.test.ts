import { beforeEach, describe, expect, it, vi } from "vitest";
import { pair, type Workspace } from "../types";
const api = vi.hoisted(() => ({ saveWorkspace: vi.fn(), bootstrap: vi.fn() }));
vi.mock("../services/tauriApi", () => ({ api }));
import { useWorkspace } from "./workspace";
const row = (key: string, value: string) => ({ ...pair(), key, value });
const initial = (): Workspace => ({
  variableRevision: 0,
  globals: [row("token", "old")],
  collections: [],
  items: [],
  environments: [],
  settings: {},
  activeEnvironment: null,
});
describe("workspace script synchronization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useWorkspace.getState().set(initial());
  });
  it("retries stale saves without replacing a script token or dropping a local variable edit", async () => {
    const base = initial();
    const latest = {
      ...base,
      variableRevision: 1,
      globals: [row("token", "script-token")],
    };
    api.saveWorkspace
      .mockRejectedValueOnce({ code: "VARIABLE_REVISION_CONFLICT" })
      .mockImplementationOnce(async (w) => ({ ...w, variableRevision: 2 }));
    api.bootstrap.mockResolvedValue({ workspace: latest });
    await useWorkspace.getState().persist({
      ...base,
      globals: [...base.globals, row("manual", "edited")],
      settings: { timeout: 123 },
    });
    expect(api.saveWorkspace.mock.calls[1][0].globals).toEqual([
      row("token", "script-token"),
      row("manual", "edited"),
    ]);
    expect(useWorkspace.getState().workspace?.settings).toEqual({
      timeout: 123,
    });
    expect(useWorkspace.getState().workspace?.variableRevision).toBe(2);
    expect(useWorkspace.getState().workspace?.globals).toEqual([
      row("token", "script-token"),
      row("manual", "edited"),
    ]);
  });
  it("refreshes script variables without replacing an in-progress local edit or environment selection", async () => {
    const base = initial();
    useWorkspace.setState({
      workspace: {
        ...base,
        globals: [...base.globals, row("draft", "local")],
        activeEnvironment: "chosen",
      },
    });
    api.bootstrap.mockResolvedValue({
      workspace: {
        ...base,
        variableRevision: 1,
        globals: [row("token", "updated")],
      },
    });
    await useWorkspace.getState().refreshVariables();
    expect(useWorkspace.getState().workspace?.globals).toEqual([
      row("token", "updated"),
      row("draft", "local"),
    ]);
    expect(useWorkspace.getState().workspace?.activeEnvironment).toBe("chosen");
  });
  it("retains script events across an in-flight save and the next workspace edit", async () => {
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    api.saveWorkspace
      .mockImplementationOnce(async (workspace) => {
        started();
        await pending;
        return workspace;
      })
      .mockImplementation(async (workspace) => workspace);
    const saving = useWorkspace
      .getState()
      .persist({ ...initial(), settings: { timeout: 123 } });
    await ready;
    useWorkspace.getState().applyScriptUpdates([
      {
        scope: "global",
        id: null,
        key: "token",
        pair: row("token", "fresh-script-token"),
        revision: 1,
      },
    ]);
    release();
    await saving;
    const current = useWorkspace.getState().workspace!;
    expect(current.globals).toEqual([row("token", "fresh-script-token")]);
    await useWorkspace
      .getState()
      .persist({ ...current, activeEnvironment: "chosen" });
    expect(api.saveWorkspace.mock.calls[1][0].globals).toEqual([
      row("token", "fresh-script-token"),
    ]);
    expect(useWorkspace.getState().workspace?.activeEnvironment).toBe("chosen");
  });
});
