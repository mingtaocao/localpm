import { create } from "zustand";
import type { Workspace } from "../types";
import { api } from "../services/tauriApi";
let queue = Promise.resolve();
export const useWorkspace = create<{
  workspace: Workspace | null;
  error: string;
  set: (w: Workspace) => void;
  persist: (w: Workspace) => Promise<void>;
}>((set) => ({
  workspace: null,
  error: "",
  set: (workspace) => set({ workspace }),
  persist: async (workspace) => {
    set({ workspace });
    const work = queue.then(async () => {
      const saved = await api.saveWorkspace(workspace);
      set((current) =>
        current.workspace === workspace ? { workspace: saved } : {},
      );
    });
    queue = work.catch((e) => set({ error: String(e?.message ?? e) }));
    await work;
  },
}));
