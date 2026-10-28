import type { Pair, RequestSpec, Workspace } from "../types";

export type SettingsLayer = { name: string; settings: any };
export function inheritedSetting(layers: SettingsLayer[], key: string) {
  const layer = layers.find(({ settings }) => {
    const value = settings?.[key];
    return value != null && !(key === "proxy" && value.mode === "inherit");
  });
  const defaults: Record<string, any> = {
    timeout: 30000,
    verifyTls: true,
    followRedirect: true,
    proxy: { mode: "off" },
    caFile: "",
  };
  return { value: layer?.settings[key] ?? defaults[key], source: layer?.name };
}

// Display provenance only; credentials remain in the existing request engine.
export function inheritedAuthorization(
  workspace: Workspace,
  request: RequestSpec,
) {
  const item = workspace.items.find((item) => item.request?.id === request.id);
  return authorizationSource(workspace, item?.parentId, item?.collectionId);
}

export function authorizationSource(
  workspace: Workspace,
  parentId: string | null | undefined,
  collectionId: string | undefined,
) {
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const folder = workspace.items.find((item) => item.id === parentId);
    if (!folder) break;
    if (folder.auth && folder.auth.type !== "inherit")
      return { type: folder.auth.type ?? "noauth", source: folder.name };
    parentId = folder.parentId;
  }
  const collection = workspace.collections.find((c) => c.id === collectionId);
  return {
    type:
      collection?.auth?.type === "inherit"
        ? "noauth"
        : (collection?.auth?.type ?? "noauth"),
    source: collection?.name,
  };
}

const references = (value: string) =>
  [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) =>
    match[1].trim(),
  );

export function urlVariableReferences(
  workspace: Workspace,
  request: RequestSpec,
) {
  const item = workspace.items.find((item) => item.request?.id === request.id);
  const collection = workspace.collections.find(
    (c) => c.id === item?.collectionId,
  );
  const environment = workspace.environments.find(
    (e) => e.id === workspace.activeEnvironment,
  );
  const variables = new Map<
    string,
    { pair: Pair; scope: string; source: string }
  >();
  for (const [scope, source, pairs] of [
    ["Global", "", workspace.globals],
    ["Collection", collection?.name ?? "", collection?.variables ?? []],
    ["Environment", environment?.name ?? "", environment?.variables ?? []],
  ] as [string, string, Pair[]][]) {
    for (const pair of pairs.filter((pair) => pair.enabled))
      variables.set(pair.key, { pair, scope, source });
  }
  function resolve(key: string, stack: string[]): string {
    if (stack.includes(key)) throw new Error("Variable cycle");
    if (stack.length >= 10) throw new Error("Variable depth exceeded");
    const variable = variables.get(key);
    if (!variable) throw new Error("Unresolved variable");
    // Mask secret references as well as explicitly marked secret values, including
    // secrets reached through another variable. Never read the credential store.
    if (variable.pair.isSecret || variable.pair.secretRef) return "••••••••";
    return variable.pair.value.replace(
      /\{\{\s*([^{}]+?)\s*\}\}/g,
      (_, next: string) => resolve(next.trim(), [...stack, key]),
    );
  }
  return [...new Set(references(request.url))].map((key) => {
    const variable = variables.get(key);
    try {
      return {
        key,
        value: resolve(key, []),
        scope: variable?.scope,
        source: variable?.source,
        valid: true,
      };
    } catch {
      return {
        key,
        value: "",
        scope: variable?.scope,
        source: variable?.source,
        valid: false,
      };
    }
  });
}
