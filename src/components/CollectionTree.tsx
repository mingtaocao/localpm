import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import type { Workspace, Item } from "../types";
export function CollectionTree({
  workspace,
  search,
  selected,
  onSelect,
  onMove,
}: {
  workspace: Workspace;
  search: string;
  selected: string;
  onSelect: (id: string, item?: Item) => void;
  onMove: (source: string, target: string) => void;
}) {
  const { t: tr } = useTranslation();
  const [scroll, setScroll] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    const byParent = new Map<string, Item[]>();
    for (const i of workspace.items) {
      const k = i.parentId ?? i.collectionId;
      const a = byParent.get(k) ?? [];
      a.push(i);
      byParent.set(k, a);
    }
    for (const a of byParent.values()) a.sort((a, b) => a.order - b.order);
    const query = search.toLowerCase();
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
      if (collapsed.has(c.id) && !query) continue;
      const stack = [...(byParent.get(c.id) ?? [])]
        .reverse()
        .map((item) => ({ item, depth: 1 }));
      while (stack.length) {
        const { item, depth } = stack.pop()!;
        if (query && !keep.has(item.id)) continue;
        result.push({ id: item.id, name: item.name, depth, item });
        if (item.kind === "folder" && (!collapsed.has(item.id) || query))
          for (const child of [...(byParent.get(item.id) ?? [])].reverse())
            stack.push({ item: child, depth: depth + 1 });
      }
    }
    return result;
  }, [workspace.items, workspace.collections, search, collapsed]);
  const start = Math.max(
    0,
    Math.min(Math.floor(scroll / 36) - 5, rows.length - 1),
  );
  const visible = rows.slice(start, start + 50);
  return (
    <div
      className="tree"
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
    >
      <div style={{ height: rows.length * 36, position: "relative" }}>
        {visible.map((row, index) => (
          <div
            key={row.id}
            className={`tree-row ${selected === row.id ? "selected" : ""}`}
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
            {(!row.item || row.item.kind === "folder") && (
              <button
                className="collapse"
                aria-label={tr(
                  collapsed.has(row.id) ? "Collapse %{name}" : "Expand %{name}",
                  { name: row.name },
                )}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    return next;
                  })
                }
              >
                {collapsed.has(row.id) ? "▸" : "▾"}
              </button>
            )}
            <button
              draggable={!!row.item}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", row.id)}
              className={row.item ? "tree-item" : "collection"}
              onClick={() => onSelect(row.id, row.item)}
            >
              <span className={row.item?.request ? "method" : "folder"}>
                {row.item?.request?.method ?? (row.item ? "▾" : "▣")}
              </span>
              <span>{row.name}</span>
            </button>
          </div>
        ))}
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
