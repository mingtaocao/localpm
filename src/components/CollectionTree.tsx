import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { readLayout, saveLayout, layoutNumber } from "../stores/layout";
import type { Workspace, Item } from "../types";
import { Icon } from "./Icon";

const EMPTY_BRANCHES = new Set<string>();
export function CollectionTree({
  workspace,
  search,
  selected,
  onSelect,
  onEdit,
  onMove,
  onAddRequest,
}: {
  workspace: Workspace;
  search: string;
  selected: string;
  onSelect: (id: string, item?: Item) => void;
  onEdit: (id: string, item?: Item) => void;
  onMove: (source: string, target: string) => void;
  onAddRequest: (collectionId: string, parentId: string | null) => void;
}) {
  const { t: tr } = useTranslation();
  const treeRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(() =>
    layoutNumber("localpm-tree-scroll", 0),
  );
  useEffect(() => {
    if (treeRef.current)
      treeRef.current.scrollTop = layoutNumber("localpm-tree-scroll", 0);
  }, []);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(readLayout("localpm-tree-collapsed") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const query = search.trim().toLowerCase();
  // Search reveals matches without changing the saved browsing layout.
  const [searchLayout, setSearchLayout] = useState({
    query: "",
    collapsed: new Set<string>(),
  });
  const hiddenBranches = query
    ? searchLayout.query === query
      ? searchLayout.collapsed
      : EMPTY_BRANCHES
    : collapsed;
  const updateSavedBranch = (id: string, hide: boolean) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (hide) next.add(id);
      else next.delete(id);
      saveLayout("localpm-tree-collapsed", JSON.stringify([...next]));
      return next;
    });
  };
  const updateBranch = (id: string, hide: boolean) => {
    if (!query) return updateSavedBranch(id, hide);
    setSearchLayout((previous) => {
      const next = new Set(previous.query === query ? previous.collapsed : []);
      if (hide) next.add(id);
      else next.delete(id);
      return { query, collapsed: next };
    });
  };
  const rows = useMemo(() => {
    const byParent = new Map<string, Item[]>();
    for (const i of workspace.items) {
      const k = i.parentId ?? i.collectionId;
      const a = byParent.get(k) ?? [];
      a.push(i);
      byParent.set(k, a);
    }
    for (const a of byParent.values()) a.sort((a, b) => a.order - b.order);
    const keep = new Set<string>();
    if (query) {
      const byId = new Map(workspace.items.map((i) => [i.id, i]));
      for (const i of workspace.items) {
        if (`${i.name} ${i.request?.url ?? ""}`.toLowerCase().includes(query)) {
          keep.add(i.id);
          keep.add(i.collectionId);
          let parent = i.parentId;
          while (parent && !keep.has(parent)) {
            keep.add(parent);
            parent = byId.get(parent)?.parentId ?? null;
          }
        }
      }
      for (const c of workspace.collections)
        if (c.name.toLowerCase().includes(query)) {
          keep.add(c.id);
          for (const i of workspace.items)
            if (i.collectionId === c.id) keep.add(i.id);
        }
    }
    const result: { id: string; name: string; depth: number; item?: Item }[] =
      [];
    for (const c of workspace.collections) {
      if (query && !keep.has(c.id)) continue;
      result.push({ id: c.id, name: c.name, depth: 0 });
      if (hiddenBranches.has(c.id)) continue;
      const stack = [...(byParent.get(c.id) ?? [])]
        .reverse()
        .map((item) => ({ item, depth: 1 }));
      while (stack.length) {
        const { item, depth } = stack.pop()!;
        if (query && !keep.has(item.id)) continue;
        result.push({ id: item.id, name: item.name, depth, item });
        if (item.kind === "folder" && !hiddenBranches.has(item.id))
          for (const child of [...(byParent.get(item.id) ?? [])].reverse())
            stack.push({ item: child, depth: depth + 1 });
      }
    }
    return result;
  }, [workspace.items, workspace.collections, query, hiddenBranches]);
  const start = Math.max(
    0,
    Math.min(Math.floor(scroll / 36) - 5, rows.length - 1),
  );
  const visible = rows.slice(start, start + 50);
  return (
    <div
      className="tree"
      ref={treeRef}
      onScroll={(e) => {
        setScroll(e.currentTarget.scrollTop);
        saveLayout("localpm-tree-scroll", String(e.currentTarget.scrollTop));
      }}
    >
      <div style={{ height: rows.length * 36, position: "relative" }}>
        {visible.map((row, index) => {
          const branch = !row.item || row.item.kind === "folder";
          const expanded = !hiddenBranches.has(row.id);
          const activate = () => {
            if (branch) updateBranch(row.id, expanded);
            onSelect(row.id, row.item);
          };
          const editLabel = tr(
            row.item ? "Edit folder %{name}" : "Edit collection %{name}",
            { name: row.name },
          );
          return (
            <div
              key={row.id}
              className={`tree-row ${selected === row.id ? "selected" : ""}`}
              data-branch={branch || undefined}
              onClick={(event) => {
                // Buttons handle their own action; padding belongs to the row.
                if (branch && event.target === event.currentTarget) activate();
              }}
              style={{
                position: "absolute",
                top: (start + index) * 36,
                left: 0,
                right: 0,
                height: 36,
                display: "flex",
                alignItems: "center",
                paddingLeft: 8 + Math.min(row.depth, 20) * 12,
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onMove(e.dataTransfer.getData("text/plain"), row.id);
              }}
            >
              {branch ? (
                <button
                  className="collapse"
                  aria-label={tr(
                    expanded ? "Collapse %{name}" : "Expand %{name}",
                    { name: row.name },
                  )}
                  aria-expanded={expanded}
                  onClick={() => updateBranch(row.id, expanded)}
                >
                  <Icon name="chevron-right" />
                </button>
              ) : (
                <span className="tree-disclosure-spacer" aria-hidden="true" />
              )}
              <button
                title={row.name}
                aria-current={selected === row.id ? "true" : undefined}
                aria-expanded={branch ? expanded : undefined}
                draggable={!!row.item}
                onDragStart={(e) =>
                  e.dataTransfer.setData("text/plain", row.id)
                }
                className={row.item ? "tree-item" : "collection"}
                onClick={activate}
              >
                {row.item?.kind === "folder" && <Icon name="folder" />}
                {row.item?.request && (
                  <span
                    className="method"
                    title={row.item.request.method}
                    data-method={row.item?.request?.method}
                  >
                    {row.item.request.method}
                  </span>
                )}
                <span>{row.name}</span>
              </button>
              {branch && (
                <button
                  className="resource-edit"
                  title={editLabel}
                  aria-label={editLabel}
                  onClick={() => onEdit(row.id, row.item)}
                >
                  <Icon name="settings" />
                </button>
              )}
              {branch && (
                <button
                  className="resource-add-request"
                  title={tr("Add request to %{name}", { name: row.name })}
                  aria-label={tr("Add request to %{name}", { name: row.name })}
                  onClick={() => {
                    updateSavedBranch(row.id, false);
                    if (query) updateBranch(row.id, false);
                    onAddRequest(
                      row.item?.collectionId ?? row.id,
                      row.item?.id ?? null,
                    );
                  }}
                >
                  <Icon name="plus" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!rows.length && (
        <p className="empty-small">
          {search
            ? tr("No matching requests.")
            : tr("Create a collection to organize your API requests.")}
        </p>
      )}
    </div>
  );
}
