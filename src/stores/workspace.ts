import { create } from "zustand";
import type { Workspace } from "../types";
import { api } from "../services/tauriApi";
import { mergeVariables } from "./variableMerge";
let queue = Promise.resolve();
let acknowledged: Workspace | null = null;
export const useWorkspace = create<{
  workspace: Workspace | null;
  error: unknown;
  set: (w: Workspace) => void;
  refreshVariables: () => Promise<void>;
  persist: (w: Workspace) => Promise<void>;
}>((set, get) => ({
  workspace: null,
  error: "",
  set: (workspace) => {
    acknowledged = workspace;
    set({ workspace });
  },
  refreshVariables: async () => {
    const work = queue.then(async () => {
      const latest = (await api.bootstrap()).workspace;
      const current = get().workspace;
      if (current && acknowledged)
        set({ workspace: mergeVariables(acknowledged, current, latest) });
      acknowledged = latest;
    });
    queue = work.catch((e) => {
      set({ error: e });
    });
    await work;
  },
  persist: async (workspace) => {
    const base = get().workspace ?? workspace;
    set({ workspace });
    const work = queue.then(async () => {
      let latest = acknowledged ?? workspace;
      let saved: Workspace | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          saved = await api.saveWorkspace(
            mergeVariables(base, workspace, latest),
          );
          break;
        } catch (e) {
          if (
            attempt === 3 ||
            !e ||
            typeof e !== "object" ||
            !("code" in e) ||
            e.code !== "VARIABLE_REVISION_CONFLICT"
          )
            throw e;
          latest = (await api.bootstrap()).workspace;
        }
      }
      if (!saved) return;
      acknowledged = saved;
      set((current) =>
        current.workspace
          ? { workspace: mergeVariables(workspace, current.workspace, saved!) }
          : {},
      );
    });
    queue = work.catch((e) => {
      set({ error: e });
    });
    await work;
  },
}));
