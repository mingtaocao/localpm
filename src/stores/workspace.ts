import { create } from "zustand";
import type { Workspace } from "../types";
import { api } from "../services/tauriApi";
import { mergeVariableUpdates, type VariableUpdate } from "../scripts/model";
let queue = Promise.resolve();
export const useWorkspace = create<{
  workspace: Workspace | null;
  error: unknown;
  set: (w: Workspace) => void;
  applyScriptUpdates: (updates: VariableUpdate[]) => void;
  persist: (w: Workspace) => Promise<void>;
  flush: () => Promise<void>;
}>((set) => ({
  workspace: null,
  error: "",
  set: (workspace) => set({ workspace }),
  applyScriptUpdates: (updates) =>
    set((current) =>
      current.workspace
        ? { workspace: mergeVariableUpdates(current.workspace, updates) }
        : {},
    ),
  flush: () => queue,
  persist: async (workspace) => {
    set({ workspace });
    const work = queue.then(async () => {
      const saved = await api.saveWorkspace(workspace);
      set((current) =>
        current.workspace === workspace ? { workspace: saved } : {},
      );
    });
    queue = work.catch((e) => set({ error: e }));
    await work;
  },
}));
