import { editorPhrases } from "./i18n/editor";
import { usePreferences } from "./stores/preferences";
import { formatError } from "./i18n/errors";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import CodeMirror, { EditorState } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { api } from "./services/tauriApi";
import { useWorkspace } from "./stores/workspace";
import {
  newRequest,
  paramsFromUrl,
  urlFromParams,
  type RequestSpec,
  type ResponseResult,
  type Pair,
  type HistoryEntry,
} from "./types";
import { KeyValue } from "./components/KeyValue";
import { Network } from "./components/Network";
import { Auth } from "./components/Auth";
import { CollectionTree } from "./components/CollectionTree";
import { HistoryPanel } from "./components/HistoryPanel";
import {
  ConsolePanel,
  type ConsoleEntry,
  type RequestDiagnostic,
} from "./components/ConsolePanel";
import { requestToCurl } from "./utils/curl";
import { Icon } from "./components/Icon";
import { MoreMenu } from "./components/MoreMenu";
type Tab = {
  request: RequestSpec;
  dirty: boolean;
  response?: ResponseResult;
  responseContext?: { time: string; environment: string; url: string };
  execution?: string;
  error?: unknown;
  saveState?: "saving" | "draft" | "saved" | "failed";
};
const DEFAULT_SIDEBAR_WIDTH = 266;
const MIN_SIDEBAR_WIDTH = 210;
const SIDEBAR_STORAGE_KEY = "local-postman.sidebar-width";
function clampSidebarWidth(width: number) {
  return Math.min(
    Math.max(MIN_SIDEBAR_WIDTH, width),
    Math.max(MIN_SIDEBAR_WIDTH, Math.min(520, window.innerWidth - 560)),
  );
}
export default function App() {
  const { t: tr } = useTranslation();
  const phrases = EditorState.phrases.of(editorPhrases());
  const { theme, language, resolvedTheme } = usePreferences();
  const {
    workspace: w,
    set: setWorkspace,
    persist,
    error: storeError,
  } = useWorkspace();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [active, setActive] = useState("");
  const [selected, setSelected] = useState("");
  const [editedEnvironmentId, setEditedEnvironmentId] = useState("");
  const [section, setSection] = useState("Collections");
  const [editor, setEditor] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [responseTab, setResponseTab] = useState("Pretty");
  const [responseFormat, setResponseFormat] = useState("Pretty");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [headerSearch, setHeaderSearch] = useState("");
  const [modal, setModal] = useState("");
  const [cookies, setCookies] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [topHeight, setTopHeight] = useState(340);
  const mainRef = useRef<HTMLElement>(null);
  const [mainHeight, setMainHeight] = useState(window.innerHeight - 52);
  useEffect(() => {
    if (!mainRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setMainHeight(entry.contentRect.height);
    });
    observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, [w !== null]);
  const tabHeight = tabs.length > 1 ? 38 : 0;
  const maxEditorHeight = Math.max(220, mainHeight - tabHeight - 5 - 140);
  const editorHeight = Math.min(topHeight, maxEditorHeight);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY));
    return clampSidebarWidth(
      Number.isFinite(saved) && saved ? saved : DEFAULT_SIDEBAR_WIDTH,
    );
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<RequestDiagnostic>("request-diagnostic", ({ payload }) => {
      setConsoleEntries((entries) =>
        entries.map((entry) =>
          entry.id === payload.id
            ? {
                ...entry,
                ...payload,
                requestHeaders: payload.headers,
                prepared: true,
              }
            : entry,
        ),
      );
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Browser test bridges do not expose Tauri event subscriptions.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const tab = tabs.find((t) => t.request.id === active);
  const r = tab?.request;
  const selectedItem = w?.items.find((i) => i.id === selected);
  const collection = w?.collections.find(
    (c) => c.id === (selectedItem?.collectionId ?? selected),
  );
  const environment = w?.environments.find((e) => e.id === w.activeEnvironment);
  const editedEnvironment = w?.environments.find(
    (e) => e.id === editedEnvironmentId,
  );
  const requestItem = w?.items.find((i) => i.request?.id === r?.id);
  const requestCollection = w?.collections.find(
    (c) => c.id === requestItem?.collectionId,
  );
  const consoleProblems = consoleEntries.filter(
    (entry) => entry.error || (entry.status ?? 0) >= 400,
  ).length;
  const fail = (e: any) => setError(e);
  useEffect(() => {
    api
      .bootstrap()
      .then((b) => {
        setWorkspace(b.workspace);
        setHistory(b.history);
        if (b.drafts.length) {
          setTabs(b.drafts.map((request) => ({ request, dirty: true })));
          setActive(b.drafts[0].id);
          setNotice("Recovered unsaved drafts.");
        } else {
          const request = newRequest();
          setTabs([{ request, dirty: false }]);
          setActive(request.id);
        }
      })
      .catch(fail);
  }, [setWorkspace]);
  const updateTab = (id: string, p: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.request.id === id ? { ...t, ...p } : t)));
  const edit = (p: Partial<RequestSpec>) => {
    if (r)
      updateTab(r.id, {
        request: { ...r, ...p },
        dirty: true,
        saveState: undefined,
      });
  };
  useEffect(() => {
    if (!tab?.dirty) return;
    const request = tab.request;
    const storedInCollection = !!w?.items.some(
      (i) => i.request?.id === request.id,
    );
    const t = setTimeout(() => {
      if (!storedInCollection) updateTab(request.id, { saveState: "saving" });
      void api
        .draft(request.id, request)
        .then(() => {
          if (!storedInCollection)
            setTabs((ts) =>
              ts.map((t) =>
                t.request === request && t.dirty
                  ? { ...t, saveState: "draft" }
                  : t,
              ),
            );
        })
        .catch((e) => {
          setTabs((ts) =>
            ts.map((t) =>
              t.request === request && t.dirty
                ? { ...t, saveState: "failed" }
                : t,
            ),
          );
          fail(e);
        });
    }, 500);
    return () => clearTimeout(t);
  }, [tab?.request, tab?.dirty]);
  const save = async () => {
    if (!r || !w) return;
    const items = [...w.items];
    const i = items.findIndex((i) => i.request?.id === r.id);
    if (i >= 0) items[i] = { ...items[i], name: r.name, request: r };
    else {
      const c = collection ?? w.collections[0];
      if (!c) {
        setError("Create a collection before saving this request.");
        return;
      }
      items.push({
        id: crypto.randomUUID(),
        collectionId: c.id,
        parentId: selectedItem?.kind === "folder" ? selectedItem.id : null,
        kind: "request",
        name: r.name,
        order: items.length,
        auth: { type: "inherit" },
        request: r,
        metadata: null,
      });
    }
    updateTab(r.id, { saveState: "saving" });
    try {
      await persist({ ...w, items });
      // Editing can continue while persistence is in flight. Preserve any newer draft.
      const current = tabsRef.current.find((t) => t.request.id === r.id);
      await api.draft(
        r.id,
        current && current.request !== r ? current.request : null,
      );
      setTabs((ts) =>
        ts.map((t) =>
          t.request === r ? { ...t, dirty: false, saveState: "saved" } : t,
        ),
      );
    } catch (e) {
      setTabs((ts) =>
        ts.map((t) => (t.request === r ? { ...t, saveState: "failed" } : t)),
      );
      throw e;
    }
  };
  useEffect(() => {
    if (!tab?.dirty || !r || !w?.items.some((i) => i.request?.id === r.id))
      return;
    const timer = setTimeout(() => void save().catch(fail), 2000);
    return () => clearTimeout(timer);
  }, [r, tab?.dirty]);
  const openRequest = (request: RequestSpec) => {
    if (!tabs.some((t) => t.request.id === request.id))
      setTabs((ts) => [
        ...ts.filter(
          (t) =>
            t.dirty ||
            t.response ||
            t.execution ||
            t.request.url ||
            w?.items.some((i) => i.request?.id === t.request.id),
        ),
        { request, dirty: false },
      ]);
    setActive(request.id);
    setEditor("");
    setModal("");
  };
  const newTab = () => {
    const request = newRequest();
    setTabs((ts) => [...ts, { request, dirty: true }]);
    setActive(request.id);
    setEditor("");
    setModal("");
  };
  const closeTab = async (id: string) => {
    const t = tabs.find((t) => t.request.id === id);
    if (t?.dirty) await api.draft(id, t.request);
    if (t?.execution) await api.cancel(t.execution);
    setTabs((ts) => ts.filter((t) => t.request.id !== id));
    if (active === id) {
      setActive(tabs.find((t) => t.request.id !== id)?.request.id ?? "");
      setEditor("");
    }
  };
  const send = async () => {
    if (!r || !w || tab?.execution) return;
    const id = crypto.randomUUID();
    const started = performance.now();
    const request = structuredClone(r);
    const sentEnvironment = environment?.name ?? tr("No environment");
    const baseEntry: ConsoleEntry = {
      id,
      time: new Date().toLocaleTimeString(),
      method: request.method,
      url: request.url,
      requestHeaders: [],
      redirects: [],
      prepared: false,
      phase: "pending",
    };
    setConsoleEntries((entries) => [baseEntry, ...entries].slice(0, 100));
    updateTab(r.id, {
      execution: id,
      error: undefined,
      response: undefined,
      responseContext: undefined,
    });
    try {
      if (w.collections.length) await save();
      else await persist(w);
      const result = await api.send(request, id);
      updateTab(r.id, {
        response: result,
        responseContext: {
          time: new Date().toLocaleTimeString(),
          environment: sentEnvironment,
          url: request.url,
        },
      });
      setConsoleEntries((entries) =>
        entries.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                phase: "complete",
                status: result.status,
                statusText: result.statusText,
                duration: result.duration,
                size: result.size,
                responseHeaders: result.headers,
                responseBody: result.body.slice(0, 64 * 1024),
                responseTruncated:
                  result.truncated || result.body.length > 64 * 1024,
                responseBinary: result.binary,
                finalUrl: result.finalUrl,
                redirects: result.redirects,
              }
            : entry,
        ),
      );
    } catch (e: unknown) {
      updateTab(r.id, { error: e });
      setConsoleEntries((entries) =>
        entries.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                phase: "error",
                duration: Math.round(performance.now() - started),
                error: formatError(e),
                errorDetail:
                  e && typeof e === "object" && "message" in e
                    ? String(e.message)
                    : String(e),
              }
            : entry,
        ),
      );
    } finally {
      updateTab(r.id, { execution: undefined });
      api.history().then(setHistory).catch(fail);
    }
  };
  const importFile = async () => {
    try {
      const result = await api.import();
      if (result) {
        setWorkspace(result);
        setNotice(
          "Postman data imported. Scripts are preserved and are not executed.",
        );
      }
    } catch (e) {
      fail(e);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (
        ["enter", "s", "n", "w", "k", ","].includes(key) ||
        (e.shiftKey && key === "i")
      ) {
        e.preventDefault();
        if (key === "enter") void send();
        if (key === "s") void save().catch(fail);
        if (key === "n") newTab();
        if (key === "w" && active) void closeTab(active);
        if (key === "k") {
          setSidebarOpen(true);
          setSection("Collections");
          requestAnimationFrame(() => searchRef.current?.focus());
        }
        if (key === ",") setModal("Settings");
        if (e.shiftKey && key === "i") void importFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const createCollection = () => {
    if (!w) return;
    const id = crypto.randomUUID();
    void persist({
      ...w,
      collections: [
        ...w.collections,
        {
          id,
          name: tr("New collection"),
          auth: { type: "noauth" },
          variables: [],
          metadata: null,
        },
      ],
    }).catch(fail);
    setSelected(id);
    setModal("Collection");
  };
  const createFolder = () => {
    if (!w || !collection) {
      setError("Select a collection first.");
      return;
    }
    const id = crypto.randomUUID();
    void persist({
      ...w,
      items: [
        ...w.items,
        {
          id,
          collectionId: collection.id,
          parentId: selectedItem?.kind === "folder" ? selectedItem.id : null,
          kind: "folder",
          name: tr("New folder"),
          order: w.items.length,
          auth: { type: "inherit" },
          request: null,
          metadata: null,
        },
      ],
    }).catch(fail);
    setSelected(id);
    setModal("Folder");
  };
  const deleteSelected = async () => {
    if (!w) return;
    const remove = new Set([selected]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const i of w.items)
        if (
          (remove.has(i.collectionId) ||
            (!!i.parentId && remove.has(i.parentId))) &&
          !remove.has(i.id)
        ) {
          remove.add(i.id);
          changed = true;
        }
    }
    const requestIds = new Set(
      w.items.filter((i) => remove.has(i.id)).map((i) => i.request?.id),
    );
    await persist({
      ...w,
      collections: w.collections.filter((c) => !remove.has(c.id)),
      items: w.items.filter((i) => !remove.has(i.id)),
    });
    setTabs((ts) => ts.filter((t) => !requestIds.has(t.request.id)));
    for (const id of requestIds) if (id) await api.draft(id, null);
    if (requestIds.has(active))
      setActive(
        tabs.find((t) => !requestIds.has(t.request.id))?.request.id ?? "",
      );
    setSelected("");
    setModal("");
  };
  const duplicate = async (itemId = selected, currentRequest?: RequestSpec) => {
    if (!w) return;
    const duplicateItem = w.items.find((i) => i.id === itemId);
    const duplicateCollection = w.collections.find(
      (c) => c.id === (duplicateItem?.collectionId ?? itemId),
    );
    if (!duplicateItem && duplicateCollection) {
      const id = crypto.randomUUID();
      const source = w.items.filter(
        (i) => i.collectionId === duplicateCollection.id,
      );
      const ids = new Map(source.map((i) => [i.id, crypto.randomUUID()]));
      await persist({
        ...w,
        collections: [
          ...w.collections,
          {
            ...structuredClone(duplicateCollection),
            id,
            name: tr("%{name} copy", { name: duplicateCollection.name }),
          },
        ],
        items: [
          ...w.items,
          ...source.map((i) => ({
            ...structuredClone(i),
            id: ids.get(i.id)!,
            collectionId: id,
            parentId: i.parentId ? ids.get(i.parentId)! : null,
            request: i.request
              ? { ...structuredClone(i.request), id: crypto.randomUUID() }
              : null,
          })),
        ],
      });
      return;
    }
    if (!duplicateItem) return;
    const source = [duplicateItem];
    for (let n = 0; n < source.length; n++)
      source.push(...w.items.filter((i) => i.parentId === source[n].id));
    const ids = new Map(source.map((i) => [i.id, crypto.randomUUID()]));
    const copied = source.map((i, n) => {
      const request = n === 0 && currentRequest ? currentRequest : i.request;
      const name =
        n === 0
          ? tr("%{name} copy", { name: currentRequest?.name ?? i.name })
          : i.name;
      return {
        ...structuredClone(i),
        id: ids.get(i.id)!,
        parentId: n === 0 ? i.parentId : ids.get(i.parentId!)!,
        name,
        order: i.order + 0.5,
        request: request
          ? { ...structuredClone(request), id: crypto.randomUUID(), name }
          : null,
      };
    });
    await persist({ ...w, items: [...w.items, ...copied] });
  };
  const move = (source: string, target: string) => {
    if (!w || source === target) return;
    const item = w.items.find((i) => i.id === source);
    const targetItem = w.items.find((i) => i.id === target);
    if (!item) return;
    let parent = targetItem;
    while (parent) {
      if (parent.id === source) return;
      parent = w.items.find((i) => i.id === parent?.parentId);
    }
    const cid = targetItem?.collectionId ?? target;
    const changed = new Set([source]);
    const children = new Map<string, string[]>();
    for (const i of w.items) {
      if (i.parentId)
        children.set(i.parentId, [...(children.get(i.parentId) ?? []), i.id]);
    }
    const todo = [source];
    while (todo.length) {
      for (const child of children.get(todo.pop()!) ?? []) {
        if (!changed.has(child)) {
          changed.add(child);
          todo.push(child);
        }
      }
    }
    const parentId =
      targetItem?.kind === "request"
        ? targetItem.parentId
        : (targetItem?.id ?? null);
    const previous = w.items
      .filter(
        (i) =>
          i.collectionId === cid &&
          i.parentId === parentId &&
          i.id !== source &&
          i.order < (targetItem?.order ?? Infinity),
      )
      .sort((a, b) => b.order - a.order)[0];
    const order =
      targetItem?.kind === "request"
        ? ((previous?.order ?? targetItem.order - 2) + targetItem.order) / 2
        : w.items.length;
    void persist({
      ...w,
      items: w.items.map((i) =>
        changed.has(i.id)
          ? {
              ...i,
              collectionId: cid,
              ...(i.id === source ? { parentId, order } : {}),
            }
          : i,
      ),
    }).catch(fail);
  };
  if (!w)
    return (
      <div className="loading">
        <div className="brand-icon">{tr("LP")}</div>
        <h2>{tr("Local Postman")}</h2>
        <p>
          {error ? formatError(error) : tr("Opening your local workspace…")}
        </p>
      </div>
    );
  const setVariables = (scope: string, rows: Pair[]) =>
    void persist(
      scope === "Global"
        ? { ...w, globals: rows }
        : scope === "Collection"
          ? {
              ...w,
              collections: w.collections.map((c) =>
                c.id === collection?.id ? { ...c, variables: rows } : c,
              ),
            }
          : {
              ...w,
              environments: w.environments.map((e) =>
                e.id === editedEnvironment?.id ? { ...e, variables: rows } : e,
              ),
            },
    ).catch(fail);
  const patchCollection = (p: any) =>
    void persist({
      ...w,
      collections: w.collections.map((c) =>
        c.id === collection?.id ? { ...c, ...p } : c,
      ),
    }).catch(fail);
  const patchFolder = (p: any) =>
    void persist({
      ...w,
      items: w.items.map((i) => (i.id === selected ? { ...i, ...p } : i)),
    }).catch(fail);
  const patchEnvironment = (p: any) =>
    void persist({
      ...w,
      environments: w.environments.map((e) =>
        e.id === editedEnvironment?.id ? { ...e, ...p } : e,
      ),
    }).catch(fail);
  const createEnvironment = () => {
    const id = crypto.randomUUID();
    void persist({
      ...w,
      environments: [
        ...w.environments,
        {
          id,
          name: tr("New environment"),
          variables: [],
          settings: {},
          metadata: null,
        },
      ],
    }).catch(fail);
    setEditedEnvironmentId(id);
    setModal("Environment");
  };
  let responseBody = tab?.response?.body ?? "";
  if (responseTab === "Pretty" && responseBody.length < 5 * 1024 * 1024) {
    try {
      responseBody = JSON.stringify(JSON.parse(responseBody), null, 2);
    } catch {
      /* Raw text remains readable. */
    }
  }
  return (
    <div className="app">
      <header className="app-header">
        <button
          className="icon-button"
          aria-label={tr(sidebarOpen ? "Hide requests" : "Show requests")}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Icon name="sidebar" />
        </button>
        {r ? (
          <input
            className="header-request-name"
            aria-label={tr("Request name")}
            value={r.name}
            onChange={(e) => edit({ name: e.target.value })}
          />
        ) : (
          <span className="header-request-name">{tr("Local Postman")}</span>
        )}
        <button
          className="icon-button"
          aria-label={tr("New request")}
          title={tr("New request")}
          onClick={newTab}
        >
          <Icon name="plus" />
        </button>
        <div className="header-actions">
          <select
            aria-label={tr("Active environment")}
            value={w.activeEnvironment ?? ""}
            onChange={(e) =>
              void persist({
                ...w,
                activeEnvironment: e.target.value || null,
              }).catch(fail)
            }
          >
            <option value="">{tr("No environment")}</option>
            {w.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label={tr("⚙ Settings")}
            title={tr("Settings")}
            onClick={() => setModal("Settings")}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <div className={`shell ${resizingSidebar ? "resizing-sidebar" : ""}`}>
        <aside style={{ width: sidebarWidth }} hidden={!sidebarOpen}>
          <div className="workspace-title">{tr("Requests")}</div>
          <input
            hidden={section !== "Collections"}
            className="search"
            ref={searchRef}
            placeholder={tr("Search name or URL  ⌘K")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <nav>
            {["Collections", "Environments", "History"].map((s) => (
              <button
                key={s}
                className={section === s ? "active" : ""}
                onClick={() => setSection(s)}
              >
                {tr(s)}
              </button>
            ))}
          </nav>
          {section === "Collections" && (
            <>
              <div className="sidebar-tools">
                <button onClick={createCollection}>
                  {tr("＋ Collection")}
                </button>
                <button onClick={createFolder}>{tr("＋ Folder")}</button>
                <button onClick={newTab}>{tr("＋ Request")}</button>
              </div>
              <CollectionTree
                workspace={w}
                search={search}
                selected={selected}
                onMove={move}
                onSelect={(id, item) => {
                  setSelected(id);
                  if (item?.request) openRequest(item.request);
                  else setModal(item ? "Folder" : "Collection");
                }}
              />
              <div className="sidebar-bottom">
                <button onClick={() => void importFile()}>
                  {tr("↓ Import Postman")}
                </button>
                <button onClick={() => setModal("Global")}>
                  {tr("Global variables")}
                </button>
              </div>
            </>
          )}
          {section === "Environments" && (
            <>
              <button className="subtle" onClick={createEnvironment}>
                {tr("＋ Environment")}
              </button>
              {w.environments.map((e) => (
                <button
                  className="tree-item"
                  key={e.id}
                  onClick={() => {
                    setEditedEnvironmentId(e.id);
                    setModal("Environment");
                  }}
                >
                  ◇ {e.name}
                  {w.activeEnvironment === e.id && (
                    <small className="environment-active">{tr("Active")}</small>
                  )}
                </button>
              ))}
              <button className="subtle" onClick={() => setModal("Global")}>
                {tr("Global variables")}
              </button>
            </>
          )}
          {section === "History" && (
            <HistoryPanel
              history={history}
              onClear={() =>
                void api
                  .clearHistory()
                  .then(() => setHistory([]))
                  .catch(fail)
              }
              onOpen={openRequest}
            />
          )}
        </aside>
        <div
          className="sidebar-divider"
          hidden={!sidebarOpen}
          role="separator"
          aria-label={tr("Resize workspace panel")}
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(520, window.innerWidth - 560),
          )}
          aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={0}
          onDoubleClick={() => {
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
            localStorage.setItem(
              SIDEBAR_STORAGE_KEY,
              String(DEFAULT_SIDEBAR_WIDTH),
            );
          }}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return;
            e.preventDefault();
            const next =
              e.key === "Home"
                ? DEFAULT_SIDEBAR_WIDTH
                : clampSidebarWidth(
                    sidebarWidth + (e.key === "ArrowRight" ? 16 : -16),
                  );
            setSidebarWidth(next);
            localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setResizingSidebar(true);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            setSidebarWidth(clampSidebarWidth(e.clientX));
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            const next = clampSidebarWidth(e.clientX);
            setSidebarWidth(next);
            localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
            setResizingSidebar(false);
          }}
          onLostPointerCapture={() => setResizingSidebar(false)}
        />
        <main ref={mainRef}>
          {tabs.length > 1 && (
            <div className="request-tabs">
              {tabs.map((t) => (
                <div
                  key={t.request.id}
                  className={active === t.request.id ? "tab active" : "tab"}
                >
                  <button
                    onClick={() => {
                      setActive(t.request.id);
                      setEditor("");
                      setModal("");
                    }}
                  >
                    <span className="method">{t.request.method}</span>{" "}
                    {t.request.name}
                    {t.dirty ? " •" : ""}
                  </button>
                  <button
                    title={tr("Close tab (draft retained)")}
                    onClick={() => void closeTab(t.request.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {modal ? (
            <div className="panel">
              <div className="panel-heading">
                <h2>{tr(modal === "Global" ? "Global variables" : modal)}</h2>
                <button onClick={() => setModal("")}>{tr("Close ×")}</button>
              </div>
              {modal === "Cookies" && (
                <>
                  <p className="muted">
                    {tr(
                      "Cookie domain, path, Secure, HttpOnly, expiry and SameSite are honored by the HTTP engine. Session cookies expire when the app exits.",
                    )}
                  </p>
                  <button
                    onClick={() =>
                      void api
                        .clearCookies()
                        .then(() => setCookies([]))
                        .catch(fail)
                    }
                  >
                    {tr("Clear cookie jar")}
                  </button>
                  <pre>{JSON.stringify(cookies, null, 2)}</pre>
                </>
              )}
              {modal === "Settings" && (
                <>
                  <h3>{tr("Appearance")}</h3>
                  <div className="form appearance">
                    <label>
                      {tr("Theme")}
                      <select
                        aria-label={tr("Theme")}
                        value={theme}
                        onChange={(e) =>
                          void persist({
                            ...w,
                            settings: { ...w.settings, theme: e.target.value },
                          }).catch(fail)
                        }
                      >
                        <option value="system">{tr("System")}</option>
                        <option value="light">{tr("Light")}</option>
                        <option value="dark">{tr("Dark")}</option>
                      </select>
                    </label>
                    <label>
                      {tr("Language")}
                      <select
                        aria-label={tr("Language")}
                        value={language}
                        onChange={(e) =>
                          void persist({
                            ...w,
                            settings: {
                              ...w.settings,
                              language: e.target.value,
                            },
                          }).catch(fail)
                        }
                      >
                        <option value="system">{tr("Follow system")}</option>
                        <option value="en-US">{tr("English")}</option>
                        <option value="zh-CN">{tr("简体中文")}</option>
                      </select>
                    </label>
                  </div>
                  <button
                    onClick={() =>
                      void api
                        .cookies()
                        .then((c) => {
                          setCookies(c);
                          setModal("Cookies");
                        })
                        .catch(fail)
                    }
                  >
                    {tr("Manage cookies")}
                  </button>
                  <Network
                    global
                    value={w.settings}
                    onChange={(settings) =>
                      void persist({ ...w, settings }).catch(fail)
                    }
                  />
                  <p className="muted">
                    {tr(
                      "Local Postman 0.5.0 · Local SQLite storage · No login · Scripts preserved, never executed.",
                    )}
                  </p>
                </>
              )}
              {modal === "Global" && (
                <KeyValue
                  secrets
                  rows={w.globals}
                  onChange={(rows) => setVariables("Global", rows)}
                />
              )}
              {modal === "Collection" && collection && (
                <>
                  <label className="form">
                    {tr("Name")}
                    <input
                      value={collection.name}
                      onChange={(e) =>
                        patchCollection({ name: e.target.value })
                      }
                    />
                  </label>
                  <Auth
                    value={collection.auth}
                    onChange={(auth) => patchCollection({ auth })}
                  />
                  <h3>{tr("Collection variables")}</h3>
                  <KeyValue
                    secrets
                    rows={collection.variables}
                    onChange={(rows) => setVariables("Collection", rows)}
                  />
                  <button
                    onClick={() =>
                      void api.export(collection.id, "collection").catch(fail)
                    }
                  >
                    {tr("Export Postman v2.1")}
                  </button>
                  <button onClick={() => void duplicate().catch(fail)}>
                    {tr("Duplicate collection")}
                  </button>
                  <button className="danger" onClick={() => setModal("Delete")}>
                    {tr("Delete collection")}
                  </button>
                </>
              )}
              {modal === "Folder" && selectedItem && (
                <>
                  <label className="form">
                    {tr("Folder name")}
                    <input
                      value={selectedItem.name}
                      onChange={(e) => patchFolder({ name: e.target.value })}
                    />
                  </label>
                  <Auth
                    value={selectedItem.auth}
                    onChange={(auth) => patchFolder({ auth })}
                  />
                  <button onClick={newTab}>
                    {tr("New request in folder")}
                  </button>
                  <button onClick={() => void duplicate().catch(fail)}>
                    {tr("Duplicate folder")}
                  </button>
                  <button className="danger" onClick={() => setModal("Delete")}>
                    {tr("Delete folder")}
                  </button>
                </>
              )}
              {modal === "Environment" &&
                (editedEnvironment ? (
                  <>
                    <div className="environment-status">
                      <span>
                        {tr("Sending environment: %{name}", {
                          name: environment?.name ?? tr("No environment"),
                        })}
                      </span>
                      <button
                        disabled={w.activeEnvironment === editedEnvironment.id}
                        onClick={() =>
                          void persist({
                            ...w,
                            activeEnvironment: editedEnvironment.id,
                          }).catch(fail)
                        }
                      >
                        {tr(
                          w.activeEnvironment === editedEnvironment.id
                            ? "Active environment"
                            : "Use environment",
                        )}
                      </button>
                    </div>
                    <label className="form">
                      {tr("Name")}
                      <input
                        value={editedEnvironment.name}
                        onChange={(e) =>
                          patchEnvironment({ name: e.target.value })
                        }
                      />
                    </label>
                    <KeyValue
                      secrets
                      rows={editedEnvironment.variables}
                      onChange={(rows) => setVariables("Environment", rows)}
                    />
                    <Network
                      value={editedEnvironment.settings}
                      onChange={(settings) => patchEnvironment({ settings })}
                    />
                    <button
                      onClick={() =>
                        void api
                          .export(editedEnvironment.id, "environment")
                          .catch(fail)
                      }
                    >
                      {tr("Export environment")}
                    </button>
                    <button
                      className="danger"
                      onClick={() => setModal("Delete environment")}
                    >
                      {tr("Delete environment")}
                    </button>
                  </>
                ) : (
                  <button onClick={createEnvironment}>
                    {tr("Create environment")}
                  </button>
                ))}
              {modal === "Delete" && (
                <>
                  <p>
                    {tr("Delete “%{name}” and its contents?", {
                      name: selectedItem?.name ?? collection?.name,
                    })}
                  </p>
                  <button
                    className="danger"
                    onClick={() => void deleteSelected().catch(fail)}
                  >
                    {tr("Delete permanently")}
                  </button>
                </>
              )}
              {modal === "Delete environment" && editedEnvironment && (
                <>
                  <p>
                    {tr("Delete “%{name}”?", { name: editedEnvironment.name })}
                  </p>
                  <button
                    className="danger"
                    onClick={() => {
                      void persist({
                        ...w,
                        activeEnvironment:
                          w.activeEnvironment === editedEnvironment.id
                            ? null
                            : w.activeEnvironment,
                        environments: w.environments.filter(
                          (e) => e.id !== editedEnvironment.id,
                        ),
                      }).catch(fail);
                      setModal("");
                    }}
                  >
                    {tr("Delete")}
                  </button>
                </>
              )}
              {modal === "Preview" && (
                <pre>{JSON.stringify(preview, null, 2)}</pre>
              )}
            </div>
          ) : r ? (
            <>
              <section
                className={`request-editor ${editor ? "" : "collapsed"}`}
                style={editor ? { height: editorHeight } : undefined}
              >
                <div className="url-bar">
                  <div className="url-field">
                    <input
                      list="methods"
                      className="method-select"
                      aria-label={tr("HTTP method")}
                      value={r.method}
                      onChange={(e) =>
                        edit({ method: e.target.value.toUpperCase() })
                      }
                    />
                    <datalist id="methods">
                      {[
                        "GET",
                        "POST",
                        "PUT",
                        "PATCH",
                        "DELETE",
                        "HEAD",
                        "OPTIONS",
                      ].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </datalist>
                    <input
                      className="url-input"
                      title={[
                        ...w.globals.map((p) => ({ ...p, scope: "Global" })),
                        ...(requestCollection?.variables ?? []).map((p) => ({
                          ...p,
                          scope: "Collection",
                        })),
                        ...(environment?.variables ?? []).map((p) => ({
                          ...p,
                          scope: "Environment",
                        })),
                      ]
                        .filter((p) => p.enabled)
                        .map(
                          (p) =>
                            `{{${p.key}}} · ${tr(p.scope)} = ${p.isSecret ? "••••••••" : p.value}`,
                        )
                        .join("\n")}
                      aria-label={tr("Request URL")}
                      placeholder={tr("Enter URL or use {{host}}/api")}
                      value={r.url}
                      onChange={(e) =>
                        edit({
                          url: e.target.value,
                          params: paramsFromUrl(e.target.value, r.params),
                        })
                      }
                    />
                  </div>
                  <button
                    className="primary"
                    onClick={() =>
                      tab?.execution
                        ? void api.cancel(tab.execution).catch(fail)
                        : void send()
                    }
                  >
                    {tr(tab?.execution ? "Cancel" : "Send")}{" "}
                    {!tab?.execution && "↗"}
                  </button>
                </div>
                {(r.settings.verifyTls === false ||
                  (r.settings.verifyTls == null &&
                    (environment?.settings.verifyTls ??
                      w.settings.verifyTls) === false)) && (
                  <div className="warning">
                    {tr("⚠ TLS verification is disabled for this request")}
                  </div>
                )}
                <div className="request-options editor-tabs">
                  {["Params", "Body", "Headers", "Authorization"].map(
                    (name) => {
                      const count =
                        name === "Params"
                          ? r.params.filter((p) => p.enabled && p.key).length
                          : name === "Headers"
                            ? r.headers.filter((p) => p.enabled && p.key).length
                            : 0;
                      const configured =
                        name === "Body"
                          ? r.body.mode !== "none"
                          : name === "Authorization" &&
                            !["inherit", "noauth"].includes(
                              r.auth?.type ?? "inherit",
                            );
                      return (
                        <button
                          key={name}
                          aria-label={tr(name)}
                          aria-expanded={editor === name}
                          className={editor === name ? "active" : ""}
                          onClick={() => setEditor(editor === name ? "" : name)}
                        >
                          {tr(name)}
                          {count > 0 && (
                            <span className="config-count">{count}</span>
                          )}
                          {configured && (
                            <span
                              className="config-count"
                              aria-label={tr("Configured")}
                            >
                              •
                            </span>
                          )}
                        </button>
                      );
                    },
                  )}
                  <div className="request-tools">
                    <span
                      className={`save-status ${tab?.saveState === "failed" ? "save-failed" : ""}`}
                      role="status"
                      title={requestCollection?.name}
                    >
                      {tr(
                        tab?.saveState === "saving"
                          ? "Saving…"
                          : tab?.saveState === "failed"
                            ? "Save failed"
                            : requestItem && !tab?.dirty
                              ? "Saved to %{name}"
                              : tab?.saveState === "draft"
                                ? "Draft saved locally"
                                : tab?.dirty
                                  ? "Unsaved changes"
                                  : "Draft",
                        { name: requestCollection?.name ?? "" },
                      )}
                    </span>
                    <MoreMenu label={tr("More actions")}>
                      <button onClick={() => void save().catch(fail)}>
                        {tr("Save ⌘S")}
                      </button>
                      <button
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(requestToCurl(r))
                            .then(() => setNotice("cURL copied."))
                            .catch(fail)
                        }
                      >
                        {tr("Copy cURL")}
                      </button>
                      <button
                        onClick={() =>
                          void api
                            .preview(r)
                            .then((p) => {
                              setPreview(p);
                              setModal("Preview");
                            })
                            .catch(fail)
                        }
                      >
                        {tr("Preview request")}
                      </button>
                      {requestItem && (
                        <>
                          <button
                            onClick={() =>
                              void duplicate(requestItem.id, r).catch(fail)
                            }
                          >
                            {tr("Duplicate")}
                          </button>
                          <button
                            className="danger"
                            onClick={() => {
                              setSelected(requestItem.id);
                              setModal("Delete");
                            }}
                          >
                            {tr("Delete")}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() =>
                          setEditor(editor === "Settings" ? "" : "Settings")
                        }
                      >
                        {tr("Request settings")}
                      </button>
                      <button
                        onClick={() =>
                          setEditor(editor === "Scripts" ? "" : "Scripts")
                        }
                      >
                        {tr("Scripts")}
                      </button>
                      <button onClick={() => setConsoleOpen(!consoleOpen)}>
                        {tr("⌘ Console")}
                        {consoleProblems > 0 && (
                          <span className="console-problem-count">
                            {consoleProblems}
                          </span>
                        )}
                      </button>
                    </MoreMenu>
                  </div>
                </div>
                <div className="editor-content" hidden={!editor}>
                  {["Settings", "Scripts"].includes(editor) && (
                    <div className="advanced-heading">
                      <span>
                        {tr(
                          editor === "Settings"
                            ? "Request settings"
                            : "Scripts",
                        )}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={tr("Close configuration")}
                        onClick={() => setEditor("")}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  )}
                  {editor === "Params" && (
                    <KeyValue
                      rows={r.params}
                      onChange={(params) =>
                        edit({ params, url: urlFromParams(r.url, params) })
                      }
                    />
                  )}
                  {editor === "Headers" && (
                    <>
                      <KeyValue
                        rows={r.headers}
                        onChange={(headers) => edit({ headers })}
                      />
                      <p className="muted">
                        {tr(
                          "System headers: Host, Content-Length and body Content-Type are generated on send. User headers take priority.",
                        )}
                      </p>
                    </>
                  )}
                  {editor === "Authorization" && (
                    <Auth value={r.auth} onChange={(auth) => edit({ auth })} />
                  )}
                  {editor === "Settings" && (
                    <Network
                      value={r.settings}
                      onChange={(settings) => edit({ settings })}
                    />
                  )}
                  {editor === "Scripts" && (
                    <>
                      <p className="warning">
                        {tr(
                          "Scripts are preserved for export. V1 does not execute scripts.",
                        )}
                      </p>
                      <pre>
                        {JSON.stringify(
                          requestItem?.metadata?.event ??
                            r.metadata?.event ??
                            [],
                          null,
                          2,
                        )}
                      </pre>
                    </>
                  )}
                  {editor === "Body" && (
                    <>
                      <div className="body-options">
                        <select
                          aria-label={tr("Body mode")}
                          value={r.body.mode}
                          onChange={(e) =>
                            edit({ body: { ...r.body, mode: e.target.value } })
                          }
                        >
                          {[
                            "none",
                            "raw",
                            "urlencoded",
                            "formdata",
                            "file",
                          ].map((m) => (
                            <option key={m} value={m}>
                              {tr(m)}
                            </option>
                          ))}
                        </select>
                        {r.body.mode === "raw" && (
                          <select
                            aria-label={tr("Raw language")}
                            value={r.body.options?.raw?.language ?? "text"}
                            onChange={(e) =>
                              edit({
                                body: {
                                  ...r.body,
                                  options: {
                                    ...r.body.options,
                                    raw: { language: e.target.value },
                                  },
                                },
                              })
                            }
                          >
                            {["text", "json", "xml", "html", "javascript"].map(
                              (l) => (
                                <option key={l} value={l}>
                                  {l === "text" ? tr("text") : l}
                                </option>
                              ),
                            )}
                          </select>
                        )}
                      </div>
                      {r.body.mode === "none" && (
                        <p className="muted">
                          {tr("This request has no body.")}
                        </p>
                      )}
                      {r.body.mode === "raw" && (
                        <CodeMirror
                          theme={resolvedTheme}
                          value={r.body.raw ?? ""}
                          extensions={[
                            phrases,
                            ...(r.body.options?.raw?.language === "json"
                              ? [json()]
                              : []),
                          ]}
                          onChange={(raw) => edit({ body: { ...r.body, raw } })}
                        />
                      )}
                      {r.body.mode === "urlencoded" && (
                        <KeyValue
                          rows={(r.body.urlencoded ?? []).map((p: any) => ({
                            key: p.key,
                            value: p.value,
                            enabled: !p.disabled,
                            description: p.description ?? "",
                          }))}
                          onChange={(rows) =>
                            edit({
                              body: {
                                ...r.body,
                                urlencoded: rows.map((p) => ({
                                  key: p.key,
                                  value: p.value,
                                  disabled: !p.enabled,
                                  description: p.description,
                                })),
                              },
                            })
                          }
                        />
                      )}
                      {r.body.mode === "formdata" && (
                        <>
                          {(r.body.formdata ?? []).map((p: any, i: number) => (
                            <div className="multipart-row" key={i}>
                              <input
                                type="checkbox"
                                checked={!p.disabled}
                                onChange={(e) =>
                                  edit({
                                    body: {
                                      ...r.body,
                                      formdata: r.body.formdata.map(
                                        (f: any, n: number) =>
                                          i === n
                                            ? {
                                                ...f,
                                                disabled: !e.target.checked,
                                              }
                                            : f,
                                      ),
                                    },
                                  })
                                }
                              />
                              <input
                                placeholder={tr("Key")}
                                value={p.key}
                                onChange={(e) =>
                                  edit({
                                    body: {
                                      ...r.body,
                                      formdata: r.body.formdata.map(
                                        (f: any, n: number) =>
                                          i === n
                                            ? { ...f, key: e.target.value }
                                            : f,
                                      ),
                                    },
                                  })
                                }
                              />
                              <select
                                value={p.type}
                                onChange={(e) =>
                                  edit({
                                    body: {
                                      ...r.body,
                                      formdata: r.body.formdata.map(
                                        (f: any, n: number) =>
                                          i === n
                                            ? { ...f, type: e.target.value }
                                            : f,
                                      ),
                                    },
                                  })
                                }
                              >
                                <option value="text">{tr("text")}</option>
                                <option value="file">{tr("file")}</option>
                              </select>
                              {p.type === "file" ? (
                                <button
                                  onClick={async () => {
                                    const src = await api.file();
                                    if (src)
                                      edit({
                                        body: {
                                          ...r.body,
                                          formdata: r.body.formdata.map(
                                            (f: any, n: number) =>
                                              i === n ? { ...f, src } : f,
                                          ),
                                        },
                                      });
                                  }}
                                >
                                  {p.src || tr("Choose file")}
                                </button>
                              ) : (
                                <input
                                  placeholder={tr("Value")}
                                  value={p.value}
                                  onChange={(e) =>
                                    edit({
                                      body: {
                                        ...r.body,
                                        formdata: r.body.formdata.map(
                                          (f: any, n: number) =>
                                            i === n
                                              ? { ...f, value: e.target.value }
                                              : f,
                                        ),
                                      },
                                    })
                                  }
                                />
                              )}
                              <button
                                onClick={() =>
                                  edit({
                                    body: {
                                      ...r.body,
                                      formdata: r.body.formdata.filter(
                                        (_: any, n: number) => n !== i,
                                      ),
                                    },
                                  })
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() =>
                              edit({
                                body: {
                                  ...r.body,
                                  formdata: [
                                    ...(r.body.formdata ?? []),
                                    { key: "", value: "", type: "text" },
                                  ],
                                },
                              })
                            }
                          >
                            {tr("＋ Add field")}
                          </button>
                        </>
                      )}
                      {r.body.mode === "file" && (
                        <button
                          onClick={async () => {
                            const src = await api.file();
                            if (src)
                              edit({ body: { mode: "file", file: { src } } });
                          }}
                        >
                          {r.body.file?.src ?? tr("Choose binary file")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>
              <div
                className="divider"
                hidden={!editor}
                role="separator"
                tabIndex={0}
                aria-label={tr("Resize request and response")}
                aria-orientation="horizontal"
                aria-valuemin={220}
                aria-valuemax={Math.round(maxEditorHeight)}
                aria-valuenow={Math.round(editorHeight)}
                onKeyDown={(e) => {
                  if (!["ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
                  e.preventDefault();
                  setTopHeight(
                    e.key === "Home"
                      ? 340
                      : Math.max(
                          220,
                          Math.min(
                            maxEditorHeight,
                            editorHeight + (e.key === "ArrowDown" ? 20 : -20),
                          ),
                        ),
                  );
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    setTopHeight(
                      Math.max(
                        220,
                        Math.min(
                          maxEditorHeight,
                          e.clientY -
                            (mainRef.current?.getBoundingClientRect().top ??
                              52) -
                            tabHeight,
                        ),
                      ),
                    );
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              />
              <section className="response">
                <div className="response-heading">
                  {tab?.response ? (
                    <>
                      <div className="metrics">
                        <b
                          className={
                            tab.response.status >= 400
                              ? "status-error"
                              : tab.response.status >= 300
                                ? "status-redirect"
                                : "status-success"
                          }
                        >
                          {tab.response.status} {tab.response.statusText}
                        </b>
                        <span>
                          {tab.response.duration} {tr("ms")}
                        </span>
                        <span>
                          {(tab.response.size / 1024).toFixed(2)} {tr("KB")}
                        </span>
                      </div>
                      <div className="response-tools">
                        <button
                          aria-label={tr("Response body")}
                          className={
                            !["Headers", "Cookies"].includes(responseTab)
                              ? "active"
                              : ""
                          }
                          onClick={() => setResponseTab(responseFormat)}
                        >
                          {tr("Response body label")}
                        </button>
                        <button
                          className={responseTab === "Headers" ? "active" : ""}
                          onClick={() => setResponseTab("Headers")}
                        >
                          {tr("Response headers")}
                        </button>
                        {!["Headers", "Cookies"].includes(responseTab) && (
                          <select
                            aria-label={tr("Response format")}
                            value={responseFormat}
                            onChange={(e) => {
                              setResponseFormat(e.target.value);
                              setResponseTab(e.target.value);
                            }}
                          >
                            {["Pretty", "Raw", "Preview"].map((format) => (
                              <option key={format} value={format}>
                                {tr(format)}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          className="icon-button"
                          aria-label={tr("Copy response")}
                          title={tr("Copy response")}
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(
                                ["Headers", "Cookies"].includes(responseTab)
                                  ? tab
                                      .response!.headers.filter(
                                        ([key]) =>
                                          responseTab !== "Cookies" ||
                                          key.toLowerCase() === "set-cookie",
                                      )
                                      .map((header) => header.join(": "))
                                      .join("\n")
                                  : responseBody,
                              )
                              .catch(fail)
                          }
                        >
                          <Icon name="copy" />
                        </button>
                        <MoreMenu label={tr("Response actions")}>
                          <button onClick={() => setResponseTab("Cookies")}>
                            {tr("Cookies")}
                          </button>
                          <button
                            onClick={() =>
                              void api
                                .saveResponse(tab.response!.file)
                                .catch(fail)
                            }
                          >
                            {tr("Save as…")}
                          </button>
                        </MoreMenu>
                      </div>
                    </>
                  ) : (
                    <h3>{tr("Response")}</h3>
                  )}
                </div>
                {tab?.responseContext && (
                  <div
                    className="response-context"
                    title={tab.responseContext.url}
                  >
                    {tr(
                      "Response received at %{time} · %{environment}",
                      tab.responseContext,
                    )}
                  </div>
                )}
                {!!tab?.error && (
                  <div role="alert" className="error">
                    {formatError(tab.error)}
                    <button onClick={() => setConsoleOpen(true)}>
                      {tr("View diagnostics")}
                    </button>
                  </div>
                )}
                {tab?.response ? (
                  <>
                    {["Headers", "Cookies"].includes(responseTab) ? (
                      <div className="response-data">
                        <input
                          placeholder={tr("Filter headers")}
                          value={headerSearch}
                          onChange={(e) => setHeaderSearch(e.target.value)}
                        />
                        {tab.response.headers
                          .filter(
                            ([k, v]) =>
                              (responseTab !== "Cookies" ||
                                k.toLowerCase() === "set-cookie") &&
                              `${k} ${v}`
                                .toLowerCase()
                                .includes(headerSearch.toLowerCase()),
                          )
                          .map(([k, v], i) => (
                            <div className="response-header" key={i}>
                              <b>{k}</b>
                              <span>{v}</span>
                              <button
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(v)
                                    .catch(fail)
                                }
                              >
                                {tr("Copy")}
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : tab.response.truncated || tab.response.binary ? (
                      <p className="empty-small">
                        {tab.response.truncated
                          ? tr("Response exceeds the 20 MB preview limit.")
                          : tr("Binary response.")}{" "}
                        {tr("Use Save as to save the complete response.")}
                      </p>
                    ) : responseTab === "Preview" &&
                      tab.response.contentType.includes("html") ? (
                      <iframe
                        title={tr("Isolated response preview")}
                        sandbox=""
                        srcDoc={responseBody}
                      />
                    ) : (
                      <CodeMirror
                        theme={resolvedTheme}
                        value={responseBody}
                        extensions={[
                          phrases,
                          ...(responseTab === "Pretty" ? [json()] : []),
                        ]}
                        basicSetup={{
                          lineNumbers: false,
                          foldGutter: false,
                          highlightActiveLine: false,
                          highlightActiveLineGutter: false,
                        }}
                        editable={false}
                      />
                    )}
                  </>
                ) : tab?.execution ? (
                  <div className="response-empty" role="status">
                    <h3>{tr("Sending request…")}</h3>
                    <p>{tr("Waiting for this request's response.")}</p>
                  </div>
                ) : !tab?.error ? (
                  <div className="response-empty">
                    <p>{tr("Your response will appear here")}</p>
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <div className="empty-workspace">
              <button className="primary" onClick={newTab}>
                {tr("＋ New request")}
              </button>
            </div>
          )}
        </main>
      </div>
      {!!(error || storeError) && (
        <div className="toast error" role="alert">
          {formatError(error || storeError)}
          <button
            onClick={() => {
              setError("");
              useWorkspace.setState({ error: "" });
            }}
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" onClick={() => setNotice("")}>
          {tr(notice)} ×
        </div>
      )}
      {consoleOpen && (
        <ConsolePanel
          entries={consoleEntries}
          onClear={() => setConsoleEntries([])}
          onClose={() => setConsoleOpen(false)}
        />
      )}
    </div>
  );
}
