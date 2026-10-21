import type { Pair, Workspace } from "../types";

// Replay only local variable edits onto the latest server scopes. Other workspace
// edits and the selected environment stay in the current UI document.
function rows(base: Pair[], edited: Pair[], latest: Pair[]): Pair[] {
  const keys = new Set([...base, ...edited].map((p) => p.key));
  let merged = latest;
  for (const key of keys) {
    const before = base.filter((p) => p.key === key);
    const after = edited.filter((p) => p.key === key);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const at = merged.findIndex((p) => p.key === key);
    merged = merged.filter((p) => p.key !== key);
    merged.splice(at < 0 ? merged.length : at, 0, ...after);
  }
  return merged;
}
export function mergeVariables(
  base: Workspace,
  edited: Workspace,
  latest: Workspace,
): Workspace {
  return {
    ...edited,
    variableRevision: latest.variableRevision ?? 0,
    globals: rows(base.globals, edited.globals, latest.globals),
    collections: edited.collections.map((c) => ({
      ...c,
      variables: rows(
        base.collections.find((b) => b.id === c.id)?.variables ?? [],
        c.variables,
        latest.collections.find((b) => b.id === c.id)?.variables ?? [],
      ),
    })),
    environments: edited.environments.map((e) => ({
      ...e,
      variables: rows(
        base.environments.find((b) => b.id === e.id)?.variables ?? [],
        e.variables,
        latest.environments.find((b) => b.id === e.id)?.variables ?? [],
      ),
    })),
  };
}
