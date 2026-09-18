import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
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
} from "./types";
import { KeyValue } from "./components/KeyValue";
import { Network } from "./components/Network";
import { Auth } from "./components/Auth";
import { CollectionTree } from "./components/CollectionTree";
type Tab = {
  request: RequestSpec;
  dirty: boolean;
  response?: ResponseResult;
  execution?: string;
  error?: string;
};
export default function App() {
  const {
    workspace: w,
    set: setWorkspace,
    persist,
    error: storeError,
  } = useWorkspace();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const [selected, setSelected] = useState("");
  const [section, setSection] = useState("Collections");
  const [editor, setEditor] = useState("Params");
  const [responseTab, setResponseTab] = useState("Pretty");
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [headerSearch, setHeaderSearch] = useState("");
  const [modal, setModal] = useState("");
  const [cookies, setCookies] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [topHeight, setTopHeight] = useState(340);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const tab = tabs.find((t) => t.request.id === active);
  const r = tab?.request;
  const selectedItem = w?.items.find((i) => i.id === selected);
  const collection = w?.collections.find(
    (c) => c.id === (selectedItem?.collectionId ?? selected),
  );
  const environment = w?.environments.find((e) => e.id === w.activeEnvironment);
  const fail = (e: any) =>
    setError(`${e?.code ?? "ERROR"}: ${e?.message ?? e}`);
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
        }
      })
      .catch(fail);
  }, [setWorkspace]);
  const updateTab = (id: string, p: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.request.id === id ? { ...t, ...p } : t)));
  const edit = (p: Partial<RequestSpec>) => {
    if (r) updateTab(r.id, { request: { ...r, ...p }, dirty: true });
  };
  useEffect(() => {
    if (!tab?.dirty) return;
    const t = setTimeout(
      () => api.draft(tab.request.id, tab.request).catch(fail),
      500,
    );
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
    await persist({ ...w, items });
    await api.draft(r.id, null);
    updateTab(r.id, { dirty: false });
    setNotice("Request saved locally.");
  };
  useEffect(() => {
    if (!tab?.dirty || !r || !w?.items.some((i) => i.request?.id === r.id))
      return;
    const timer = setTimeout(() => void save().catch(fail), 2000);
    return () => clearTimeout(timer);
  }, [r, tab?.dirty]);
  const openRequest = (request: RequestSpec) => {
    if (!tabs.some((t) => t.request.id === request.id))
      setTabs((ts) => [...ts, { request, dirty: false }]);
    setActive(request.id);
    setModal("");
  };
  const newTab = () => {
    const request = newRequest();
    setTabs((ts) => [...ts, { request, dirty: true }]);
    setActive(request.id);
    setModal("");
  };
  const closeTab = async (id: string) => {
    const t = tabs.find((t) => t.request.id === id);
    if (t?.dirty) await api.draft(id, t.request);
    if (t?.execution) await api.cancel(t.execution);
    setTabs((ts) => ts.filter((t) => t.request.id !== id));
    if (active === id)
      setActive(tabs.find((t) => t.request.id !== id)?.request.id ?? "");
  };
  const send = async () => {
    if (!r || !w) return;
    const id = crypto.randomUUID();
    updateTab(r.id, { execution: id, error: undefined });
    try {
      if (w.collections.length) await save();
      else await persist(w);
      const result = await api.send(r, id);
      updateTab(r.id, { response: result });
      setLogs((ls) =>
        [
          `${new Date().toLocaleTimeString()} ${r.method} · ${result.status} · ${result.duration} ms`,
          ...ls,
        ].slice(0, 100),
      );
    } catch (e: any) {
      updateTab(r.id, { error: `${e.code ?? "ERROR"}: ${e.message ?? e}` });
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
        if (key === "k") searchRef.current?.focus();
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
          name: "New collection",
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
          name: "New folder",
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
    setSelected("");
    setModal("");
  };
  const duplicate = async () => {
    if (!w || !selectedItem) return;
    const source = [selectedItem];
    for (let n = 0; n < source.length; n++)
      source.push(...w.items.filter((i) => i.parentId === source[n].id));
    const ids = new Map(source.map((i) => [i.id, crypto.randomUUID()]));
    const copied = source.map((i, n) => ({
      ...structuredClone(i),
      id: ids.get(i.id)!,
      parentId: n === 0 ? i.parentId : ids.get(i.parentId!)!,
      name: n === 0 ? `${i.name} copy` : i.name,
      order: i.order + 0.5,
      request: i.request
        ? { ...structuredClone(i.request), id: crypto.randomUUID() }
        : null,
    }));
    await persist({ ...w, items: [...w.items, ...copied] });
  };
  const move = (source: string, target: string) => {
    if (!w || source === target) return;
    const item = w.items.find((i) => i.id === source);
    const targetItem = w.items.find((i) => i.id === target);
    if (!item || targetItem?.kind === "request") return;
    let parent = targetItem;
    while (parent) {
      if (parent.id === source) return;
      parent = w.items.find((i) => i.id === parent?.parentId);
    }
    const cid = targetItem?.collectionId ?? target;
    const changed = new Set([source]);
    for (let n = 0; n < w.items.length; n++)
      for (const i of w.items)
        if (i.parentId && changed.has(i.parentId)) changed.add(i.id);
    void persist({
      ...w,
      items: w.items.map((i) =>
        changed.has(i.id)
          ? {
              ...i,
              collectionId: cid,
              ...(i.id === source
                ? { parentId: targetItem?.id ?? null, order: w.items.length }
                : {}),
            }
          : i,
      ),
    }).catch(fail);
  };
  if (!w)
    return (
      <div className="loading">
        <div className="brand-icon">LP</div>
        <h2>Local Postman</h2>
        <p>{error || "Opening your local workspace…"}</p>
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
                e.id === environment?.id ? { ...e, variables: rows } : e,
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
        e.id === environment?.id ? { ...e, ...p } : e,
      ),
    }).catch(fail);
  const createEnvironment = () => {
    const id = crypto.randomUUID();
    void persist({
      ...w,
      activeEnvironment: id,
      environments: [
        ...w.environments,
        {
          id,
          name: "New environment",
          variables: [],
          settings: {},
          metadata: null,
        },
      ],
    }).catch(fail);
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
      <header>
        <div className="brand">
          <span className="brand-icon">LP</span>Local Postman{" "}
          <small>LOCAL WORKSPACE</small>
        </div>
        <div className="header-actions">
          <span className="offline">● All data stays on this device</span>
          <select
            aria-label="Active environment"
            value={w.activeEnvironment ?? ""}
            onChange={(e) =>
              void persist({
                ...w,
                activeEnvironment: e.target.value || null,
              }).catch(fail)
            }
          >
            <option value="">No environment</option>
            {w.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button onClick={() => setModal("Settings")}>⚙ Settings</button>
        </div>
      </header>
      <div className="shell">
        <aside>
          <div className="workspace-title">
            My Workspace <span>⌄</span>
          </div>
          <input
            className="search"
            ref={searchRef}
            placeholder="Search name or URL  ⌘K"
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
                {s}
              </button>
            ))}
          </nav>
          {section === "Collections" && (
            <>
              <div className="sidebar-tools">
                <button onClick={createCollection}>＋ Collection</button>
                <button onClick={createFolder}>＋ Folder</button>
                <button onClick={newTab}>＋ Request</button>
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
                  ↓ Import Postman
                </button>
                <button onClick={() => setModal("Global")}>
                  Global variables
                </button>
              </div>
            </>
          )}
          {section === "Environments" && (
            <>
              <button className="subtle" onClick={createEnvironment}>
                ＋ Environment
              </button>
              {w.environments.map((e) => (
                <button
                  className="tree-item"
                  key={e.id}
                  onClick={() => {
                    void persist({ ...w, activeEnvironment: e.id }).catch(fail);
                    setModal("Environment");
                  }}
                >
                  ◇ {e.name}
                </button>
              ))}
              <button className="subtle" onClick={() => setModal("Global")}>
                Global variables
              </button>
            </>
          )}
          {section === "History" && (
            <div className="history-list">
              <button
                onClick={() =>
                  void api
                    .clearHistory()
                    .then(() => setHistory([]))
                    .catch(fail)
                }
              >
                Clear history
              </button>
              {history.map((h) => (
                <button
                  key={h.id}
                  className="history-item"
                  onClick={() =>
                    openRequest({
                      ...h.snapshot,
                      id: crypto.randomUUID(),
                      name: `History · ${h.snapshot.name}`,
                    })
                  }
                >
                  <span className="method">{h.snapshot.method}</span>
                  <b>{h.response.status ?? h.response.error?.code}</b>
                  <span>{h.snapshot.url}</span>
                  <small>{h.time}</small>
                </button>
              ))}
            </div>
          )}
        </aside>
        <main>
          <div className="request-tabs">
            {tabs.map((t) => (
              <div
                key={t.request.id}
                className={active === t.request.id ? "tab active" : "tab"}
              >
                <button
                  onClick={() => {
                    setActive(t.request.id);
                    setModal("");
                  }}
                >
                  <span className="method">{t.request.method}</span>{" "}
                  {t.request.name}
                  {t.dirty ? " •" : ""}
                </button>
                <button
                  title="Close tab (draft retained)"
                  onClick={() => void closeTab(t.request.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <button onClick={newTab}>＋</button>
          </div>
          {modal ? (
            <div className="panel">
              <div className="panel-heading">
                <h2>{modal === "Global" ? "Global variables" : modal}</h2>
                <button onClick={() => setModal("")}>Close ×</button>
              </div>
              {modal === "Cookies" && (
                <>
                  <p className="muted">
                    Cookie domain, path, Secure, HttpOnly, expiry and SameSite
                    are honored by the HTTP engine. Session cookies expire when
                    the app exits.
                  </p>
                  <button
                    onClick={() =>
                      void api
                        .clearCookies()
                        .then(() => setCookies([]))
                        .catch(fail)
                    }
                  >
                    Clear cookie jar
                  </button>
                  <pre>{JSON.stringify(cookies, null, 2)}</pre>
                </>
              )}
              {modal === "Settings" && (
                <>
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
                    Manage cookies
                  </button>
                  <Network
                    global
                    value={w.settings}
                    onChange={(settings) =>
                      void persist({ ...w, settings }).catch(fail)
                    }
                  />
                  <p className="muted">
                    Local Postman 0.1.0 · Local SQLite storage · No login ·
                    Scripts preserved, never executed.
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
                    Name
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
                  <h3>Collection variables</h3>
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
                    Export Postman v2.1
                  </button>
                  <button className="danger" onClick={() => setModal("Delete")}>
                    Delete collection
                  </button>
                </>
              )}
              {modal === "Folder" && selectedItem && (
                <>
                  <label className="form">
                    Folder name
                    <input
                      value={selectedItem.name}
                      onChange={(e) => patchFolder({ name: e.target.value })}
                    />
                  </label>
                  <Auth
                    value={selectedItem.auth}
                    onChange={(auth) => patchFolder({ auth })}
                  />
                  <button onClick={newTab}>New request in folder</button>
                  <button onClick={() => void duplicate().catch(fail)}>
                    Duplicate folder
                  </button>
                  <button className="danger" onClick={() => setModal("Delete")}>
                    Delete folder
                  </button>
                </>
              )}
              {modal === "Environment" &&
                (environment ? (
                  <>
                    <label className="form">
                      Name
                      <input
                        value={environment.name}
                        onChange={(e) =>
                          patchEnvironment({ name: e.target.value })
                        }
                      />
                    </label>
                    <KeyValue
                      secrets
                      rows={environment.variables}
                      onChange={(rows) => setVariables("Environment", rows)}
                    />
                    <Network
                      value={environment.settings}
                      onChange={(settings) => patchEnvironment({ settings })}
                    />
                    <button
                      onClick={() =>
                        void api
                          .export(environment.id, "environment")
                          .catch(fail)
                      }
                    >
                      Export environment
                    </button>
                    <button
                      className="danger"
                      onClick={() => setModal("Delete environment")}
                    >
                      Delete environment
                    </button>
                  </>
                ) : (
                  <button onClick={createEnvironment}>
                    Create environment
                  </button>
                ))}
              {modal === "Delete" && (
                <>
                  <p>
                    Delete “{selectedItem?.name ?? collection?.name}” and its
                    contents?
                  </p>
                  <button
                    className="danger"
                    onClick={() => void deleteSelected().catch(fail)}
                  >
                    Delete permanently
                  </button>
                </>
              )}
              {modal === "Delete environment" && environment && (
                <>
                  <p>Delete “{environment.name}”?</p>
                  <button
                    className="danger"
                    onClick={() => {
                      void persist({
                        ...w,
                        activeEnvironment: null,
                        environments: w.environments.filter(
                          (e) => e.id !== environment.id,
                        ),
                      }).catch(fail);
                      setModal("");
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
              {modal === "Preview" && (
                <pre>{JSON.stringify(preview, null, 2)}</pre>
              )}
            </div>
          ) : r ? (
            <>
              <section className="request-editor" style={{ height: topHeight }}>
                <div className="request-title">
                  <input
                    aria-label="Request name"
                    value={r.name}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                  <button onClick={() => void save().catch(fail)}>
                    Save ⌘S
                  </button>
                  {selectedItem?.request?.id === r.id && (
                    <>
                      <button onClick={() => void duplicate().catch(fail)}>
                        Duplicate
                      </button>
                      <button onClick={() => setModal("Delete")}>Delete</button>
                    </>
                  )}
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
                    Preview request
                  </button>
                </div>
                <div className="url-bar">
                  <input
                    list="methods"
                    className="method-select"
                    aria-label="HTTP method"
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
                      <option key={m}>{m}</option>
                    ))}
                  </datalist>
                  <input
                    className="url-input"
                    title={[
                      ...w.globals.map((p) => ({ ...p, scope: "Global" })),
                      ...(collection?.variables ?? []).map((p) => ({
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
                          `{{${p.key}}} · ${p.scope} = ${p.isSecret ? "••••••••" : p.value}`,
                      )
                      .join("\n")}
                    aria-label="Request URL"
                    placeholder="Enter URL or use {{host}}/api"
                    value={r.url}
                    onChange={(e) =>
                      edit({
                        url: e.target.value,
                        params: paramsFromUrl(e.target.value, r.params),
                      })
                    }
                  />
                  <button
                    className="primary"
                    onClick={() =>
                      tab?.execution
                        ? void api.cancel(tab.execution).catch(fail)
                        : void send()
                    }
                  >
                    {tab?.execution ? "Cancel" : "Send"}{" "}
                    {!tab?.execution && "↗"}
                  </button>
                </div>
                {(r.settings.verifyTls === false ||
                  (r.settings.verifyTls == null &&
                    (environment?.settings.verifyTls ??
                      w.settings.verifyTls) === false)) && (
                  <div className="warning">
                    ⚠ TLS verification is disabled for this request
                  </div>
                )}
                <div className="editor-tabs">
                  {[
                    "Params",
                    "Authorization",
                    "Headers",
                    "Body",
                    "Settings",
                    "Scripts",
                  ].map((t) => (
                    <button
                      key={t}
                      className={editor === t ? "active" : ""}
                      onClick={() => setEditor(t)}
                    >
                      {t}
                      {t === "Headers" && r.headers.length > 0
                        ? ` (${r.headers.length})`
                        : ""}
                    </button>
                  ))}
                </div>
                <div className="editor-content">
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
                        System headers: Host, Content-Length and body
                        Content-Type are generated on send. User headers take
                        priority.
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
                        Scripts are preserved for export. V1 does not execute
                        scripts.
                      </p>
                      <pre>
                        {JSON.stringify(
                          selectedItem?.metadata?.event ??
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
                          aria-label="Body mode"
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
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                        {r.body.mode === "raw" && (
                          <select
                            aria-label="Raw language"
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
                                <option key={l}>{l}</option>
                              ),
                            )}
                          </select>
                        )}
                      </div>
                      {r.body.mode === "none" && (
                        <p className="muted">This request has no body.</p>
                      )}
                      {r.body.mode === "raw" && (
                        <CodeMirror
                          value={r.body.raw ?? ""}
                          extensions={
                            r.body.options?.raw?.language === "json"
                              ? [json()]
                              : []
                          }
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
                                placeholder="Key"
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
                                <option>text</option>
                                <option>file</option>
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
                                  {p.src || "Choose file"}
                                </button>
                              ) : (
                                <input
                                  placeholder="Value"
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
                            ＋ Add field
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
                          {r.body.file?.src ?? "Choose binary file"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>
              <div
                className="divider"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    setTopHeight(
                      Math.max(
                        220,
                        Math.min(window.innerHeight - 260, e.clientY - 95),
                      ),
                    );
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              />
              <section className="response">
                <div className="response-heading">
                  <h3>Response</h3>
                  {tab?.response && (
                    <div className="metrics">
                      <b>
                        {tab.response.status} {tab.response.statusText}
                      </b>
                      <span>{tab.response.duration} ms</span>
                      <span>{(tab.response.size / 1024).toFixed(2)} KB</span>
                      <button
                        onClick={() =>
                          void api.saveResponse(tab.response!.file).catch(fail)
                        }
                      >
                        Save as…
                      </button>
                    </div>
                  )}
                </div>
                {tab?.error && (
                  <div role="alert" className="error">
                    {tab.error}
                  </div>
                )}
                {tab?.response ? (
                  <>
                    <div className="editor-tabs">
                      {["Pretty", "Raw", "Preview", "Headers", "Cookies"].map(
                        (t) => (
                          <button
                            key={t}
                            className={responseTab === t ? "active" : ""}
                            onClick={() => setResponseTab(t)}
                          >
                            {t}
                          </button>
                        ),
                      )}
                    </div>
                    {["Headers", "Cookies"].includes(responseTab) ? (
                      <div className="response-data">
                        <input
                          placeholder="Filter headers"
                          value={headerSearch}
                          onChange={(e) => setHeaderSearch(e.target.value)}
                        />
                        <button
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(
                                tab
                                  .response!.headers.map((h) => h.join(": "))
                                  .join("\n"),
                              )
                              .catch(fail)
                          }
                        >
                          Copy all
                        </button>
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
                                Copy
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : tab.response.truncated || tab.response.binary ? (
                      <p className="empty-small">
                        {tab.response.truncated
                          ? "Response exceeds the 20 MB preview limit."
                          : "Binary response."}{" "}
                        Use Save as to save the complete response.
                      </p>
                    ) : responseTab === "Preview" &&
                      tab.response.contentType.includes("html") ? (
                      <iframe
                        title="Isolated response preview"
                        sandbox=""
                        srcDoc={responseBody}
                      />
                    ) : (
                      <CodeMirror
                        value={responseBody}
                        extensions={responseTab === "Pretty" ? [json()] : []}
                        editable={false}
                      />
                    )}
                  </>
                ) : (
                  <div className="response-empty">
                    <span>↗</span>
                    <h3>Your response will appear here</h3>
                    <p>Send a request to inspect status, headers and body.</p>
                    <small>⌘ Enter to send</small>
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="welcome">
              <div className="brand-icon">LP</div>
              <h1>Your APIs. Your machine.</h1>
              <p>
                A local workspace for requests, environments and collections.
              </p>
              <button className="primary" onClick={newTab}>
                ＋ New request
              </button>
              <button onClick={() => void importFile()}>
                Import Postman collection
              </button>
              <div className="welcome-grid">
                <div>
                  <b>01 / Organize</b>
                  <p>Collections and folders keep your work together.</p>
                </div>
                <div>
                  <b>02 / Configure</b>
                  <p>Switch environments and resolve variables locally.</p>
                </div>
                <div>
                  <b>03 / Inspect</b>
                  <p>Send through Rust with full proxy control.</p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      {(error || storeError) && (
        <div className="toast error" role="alert">
          {error || storeError}
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
          {notice} ×
        </div>
      )}
      <footer>
        <button onClick={() => setConsoleOpen(!consoleOpen)}>
          ⌘ Console {consoleOpen ? "⌄" : "⌃"}
        </button>
        <span>SQLite · Local only</span>
        <span>
          {tabs.length} open request{tabs.length !== 1 ? "s" : ""}
        </span>
      </footer>
      {consoleOpen && (
        <div className="console">
          {logs.length
            ? logs.map((s, i) => <div key={i}>{s}</div>)
            : "No requests sent this session. Credentials are never logged."}
        </div>
      )}
    </div>
  );
}
