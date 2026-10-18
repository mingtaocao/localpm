import type { Workspace } from "../types";

// Freeze only the scopes used by this execution, before any persistence awaits.
export function executionWorkspace(
  workspace: Workspace,
  requestId: string,
): Workspace {
  const item = workspace.items.find((item) => item.request?.id === requestId);
  const ancestors = new Set<string>();
  let current = item;
  while (current && !ancestors.has(current.id)) {
    ancestors.add(current.id);
    current = workspace.items.find((parent) => parent.id === current?.parentId);
  }
  return structuredClone({
    ...workspace,
    collections: workspace.collections.filter(
      (collection) => collection.id === item?.collectionId,
    ),
    items: workspace.items.filter((item) => ancestors.has(item.id)),
    environments: workspace.environments.filter(
      (environment) => environment.id === workspace.activeEnvironment,
    ),
  });
}
