import { create } from "zustand";
import type { Workspace } from "../types";
import { api } from "../services/tauriApi";
import { mergeVariableUpdates, type VariableUpdate } from "../scripts/model";
import { mergeVariables } from "./variableMerge";
let queue = Promise.resolve();
let acknowledged: Workspace | null = null;
let updatesDuringSave: VariableUpdate[] | null = null;
export const useWorkspace = create<{
  workspace: Workspace | null;
  error: unknown;
  set: (w: Workspace) => void;
  refreshVariables: () => Promise<void>;
  applyScriptUpdates: (updates: VariableUpdate[]) => void;
  flush: () => Promise<void>;
  persist: (w: Workspace) => Promise<void>;
}>((set, get) => ({
  workspace: null,
  error: "",
  set: (workspace) => {
    acknowledged = workspace;
    set({ workspace });
  },
  flush: () => queue,
  applyScriptUpdates: (updates) => {
    updatesDuringSave?.push(...updates);
    const current = get().workspace;
    if (current) set({ workspace: mergeVariableUpdates(current, updates) });
    if (acknowledged)
      acknowledged = mergeVariableUpdates(acknowledged, updates);
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
      updatesDuringSave = [];
      try {
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
        // Events received while a save was pending also belong to its acknowledged baseline.
        saved = mergeVariableUpdates(saved, updatesDuringSave);
        acknowledged = saved;
        set((current) =>
          current.workspace
            ? {
                workspace: mergeVariables(workspace, current.workspace, saved!),
              }
            : {},
        );
      } finally {
        updatesDuringSave = null;
      }
    });
    queue = work.catch((e) => {
      set({ error: e });
    });
    await work;
  },
}));
