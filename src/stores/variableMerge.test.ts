import { describe, expect, it } from "vitest";
import { mergeVariables } from "./variableMerge";
import { pair, type Workspace } from "../types";
const row = (key: string, value: string) => ({ ...pair(), key, value });
const initial = (): Workspace => ({
  variableRevision: 0,
  collections: [],
  items: [],
  environments: [],
  globals: [row("token", "old"), row("manual", "old")],
  settings: {},
  activeEnvironment: null,
});
describe("script variable rebase", () => {
  it("retains script writes while saving unrelated workspace changes", () => {
    const base = initial();
    const edited = { ...base, settings: { timeout: 100 } };
    const latest = {
      ...base,
      variableRevision: 1,
      globals: [row("token", "new"), row("manual", "old")],
    };
    expect(mergeVariables(base, edited, latest)).toEqual({
      ...latest,
      settings: { timeout: 100 },
    });
  });
  it("replays explicit local edits and deletions without dropping new script keys", () => {
    const base = initial();
    const edited = { ...base, globals: [row("manual", "edited")] };
    const latest = {
      ...base,
      variableRevision: 2,
      globals: [row("token", "new"), row("manual", "old"), row("id", "42")],
    };
    expect(mergeVariables(base, edited, latest).globals).toEqual([
      row("manual", "edited"),
      row("id", "42"),
    ]);
  });
});
