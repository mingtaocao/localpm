import type { RequestSpec, Workspace } from "../types";
export type ScriptSet = {
  enabled: boolean;
  preRequest: string;
  postResponse: string;
};
export type VariableUpdate = {
  scope: "global" | "collection" | "environment";
  id: string | null;
  key: string;
  pair: import("../types").Pair | null;
  revision: number;
};
export function readScripts(metadata: any): ScriptSet {
  if (metadata?.localpmScripts)
    return {
      enabled: false,
      preRequest: "",
      postResponse: "",
      ...metadata.localpmScripts,
    };
  const code = (listen: string) =>
    (metadata?.event ?? [])
      .filter((e: any) => e.listen === listen && !e.disabled)
      .map((e: any) =>
        Array.isArray(e.script?.exec)
          ? e.script.exec.join("\n")
          : (e.script?.exec ?? ""),
      )
      .join("\n");
  return {
    enabled: false,
    preRequest: code("prerequest"),
    postResponse: code("test"),
  };
}
export function requestScripts(
  request: RequestSpec,
  itemMetadata?: any,
  inheritedEnabled = false,
): ScriptSet {
  const scripts = readScripts(
    request.metadata?.localpmScripts
      ? request.metadata
      : itemMetadata?.event
        ? itemMetadata
        : request.metadata,
  );
  if (!request.metadata?.localpmScripts) scripts.enabled = inheritedEnabled;
  return scripts;
}
const sameTarget = (a: any, b: any) =>
  a.scope === b.scope && a.id === b.id && a.key === b.key;
export function mergeVariableUpdates(
  workspace: Workspace,
  updates: VariableUpdate[],
): Workspace {
  const next = structuredClone(workspace);
  const versions: any[] = next.settings.scriptVariableVersions ?? [];
  let changed = false;
  for (const update of updates) {
    if (
      (versions.find((v) => sameTarget(v, update))?.revision ?? 0) >=
      update.revision
    )
      continue;
    const target =
      update.scope === "global"
        ? next.globals
        : update.scope === "environment"
          ? next.environments.find((e) => e.id === update.id)?.variables
          : next.collections.find((c) => c.id === update.id)?.variables;
    if (!target) continue;
    const index = target.findIndex((p) => p.key === update.key);
    if (update.pair) {
      if (index >= 0) target[index] = update.pair;
      else target.push(update.pair);
    } else if (index >= 0) target.splice(index, 1);
    const versionIndex = versions.findIndex((v) => sameTarget(v, update));
    if (versionIndex >= 0) versions.splice(versionIndex, 1);
    versions.push({
      scope: update.scope,
      id: update.id,
      key: update.key,
      revision: update.revision,
    });
    next.settings.scriptRevision = Math.max(
      next.settings.scriptRevision ?? 0,
      update.revision,
    );
    changed = true;
  }
  next.settings.scriptVariableVersions = versions;
  return changed ? next : workspace;
}

export function inheritedScriptNames(
  workspace: Workspace,
  request: RequestSpec,
): string[] {
  const item = workspace.items.find((i) => i.request?.id === request.id);
  if (!item) return [];
  const collection = workspace.collections.find(
    (c) => c.id === item.collectionId,
  );
  const chain = [];
  const visited = new Set<string>();
  let parent = workspace.items.find((i) => i.id === item.parentId);
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    chain.unshift(parent);
    parent = workspace.items.find((i) => i.id === parent?.parentId);
  }
  return [...(collection ? [collection] : []), ...chain]
    .filter((item) => {
      const scripts = readScripts(item.metadata);
      return scripts.preRequest.trim() || scripts.postResponse.trim();
    })
    .map((item) => item.name);
}
