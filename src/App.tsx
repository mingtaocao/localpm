import { ScriptEditor } from "./components/scripts/ScriptEditor";
import { ScriptResults } from "./components/scripts/ScriptResults";
import {
  requestScripts,
  readScripts,
  inheritedScriptNames,
  type VariableUpdate,
} from "./scripts/model";
import { version as appVersion } from "../package.json";
import { usePreferences } from "./stores/preferences";
import { formatError } from "./i18n/errors";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "./components/editor/CodeEditor";
import { EditorSessions } from "./components/editor/editorSessions";
import type { EditorLanguage } from "./components/editor/editorExtensions";
import {
  defaultRequestView,
  patchRequestView,
  type RequestTab as Tab,
  type RequestView,
} from "./stores/requestTabs";
import { responsePresentation } from "./components/editor/responsePresentation";
import { api } from "./services/tauriApi";
import { useWorkspace } from "./stores/workspace";
import { RequestDrafts } from "./stores/drafts";
import { executionWorkspace } from "./stores/executionContext";
import {
  newRequest,
  paramsFromUrl,
  urlFromParams,
  type RequestSpec,
  type Pair,
  type HistoryEntry,
  type ExecutionRecord,
} from "./types";
import { KeyValue } from "./components/KeyValue";
import { Network } from "./components/Network";
import { Auth } from "./components/Auth";
import { CollectionTree } from "./components/CollectionTree";
import { HistoryPanel } from "./components/HistoryPanel";
import { McpSettings } from "./components/McpSettings";
import { McpStatusStrip } from "./components/McpStatusStrip";
import { McpExecutionPanel } from "./components/McpExecutionPanel";
import {
  ConsolePanel,
  type ConsoleEntry,
  type RequestDiagnostic,
} from "./components/ConsolePanel";
import { requestToCurl } from "./utils/curl";
import { Icon } from "./components/Icon";
import { MethodSelect } from "./components/MethodSelect";
import { MoreMenu } from "./components/MoreMenu";
import { readLayout, saveLayout, layoutNumber } from "./stores/layout";
import { AnimatedCounter } from "./components/rare-ui/animated-counter";
type SaveTarget = { collectionId: string; parentId: string | null };
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 220;
const SIDEBAR_STORAGE_KEY = "local-postman.sidebar-width";
function clampSidebarWidth(width: number) {
  return Math.min(
    Math.max(MIN_SIDEBAR_WIDTH, width),
    Math.max(MIN_SIDEBAR_WIDTH, Math.min(420, window.innerWidth - 560)),
  );
}
export default function App() {
  const { t: tr } = useTranslation();
  const { theme, language, resolvedTheme } = usePreferences();
  const {
    workspace: w,
    set: setWorkspace,
    persist,
    error: storeError,
  } = useWorkspace();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [drafts] = useState(() => new RequestDrafts(api.draft));
  useEffect(() => () => drafts.dispose(), [drafts]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeSends = useRef(
    new Map<string, { id: string; cancelled: boolean; started: boolean }>(),
  );
  const [active, setActive] = useState("");
  const activeRef = useRef(active);
  activeRef.current = active;
  const [selected, setSelected] = useState("");
  const [editedEnvironmentId, setEditedEnvironmentId] = useState("");
  const [section, setSection] = useState("Collections");
  const [editorSessions] = useState(() => new EditorSessions());
  const [saveDestination, setSaveDestination] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => readLayout("localpm-sidebar-open") !== "false",
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [aiExecutions, setAiExecutions] = useState<ExecutionRecord[]>([]);
  const [viewedExecution, setViewedExecution] =
    useState<ExecutionRecord | null>(null);
  const executionRecords = useRef(new Map<string, ExecutionRecord>());
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState("");
  const [cookies, setCookies] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [topHeight, setTopHeight] = useState<number | null>(() => {
    const value = layoutNumber("localpm-editor-height", 0);
    return value || null;
  });
  const [resizingEditor, setResizingEditor] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainHeight, setMainHeight] = useState(window.innerHeight - 48);
  useEffect(() => {
    if (!mainRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setMainHeight(entry.contentRect.height);
    });
    observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, [w !== null]);
  const tabHeight = 38;
  const maxEditorHeight = Math.max(180, mainHeight - tabHeight - 1 - 160);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = layoutNumber(SIDEBAR_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH);
    return clampSidebarWidth(
      Number.isFinite(saved) && saved ? saved : DEFAULT_SIDEBAR_WIDTH,
    );
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  useEffect(() => {
    const fit = () => setSidebarWidth((width) => clampSidebarWidth(width));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const [consoleOpen, setConsoleOpen] = useState(
    () => readLayout("localpm-console-open") === "true",
  );
  useEffect(
    () => saveLayout("localpm-console-open", String(consoleOpen)),
    [consoleOpen],
  );
  useEffect(
    () => saveLayout("localpm-sidebar-open", String(sidebarOpen)),
    [sidebarOpen],
  );
  useEffect(() => {
    if (topHeight !== null)
      saveLayout("localpm-editor-height", String(topHeight));
  }, [topHeight]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const receive = (record: ExecutionRecord) => {
      if (disposed) return;
      const previous = executionRecords.current.get(record.id);
      if (
        record.status === "running" &&
        previous &&
        previous.status !== "running"
      )
        return;
      executionRecords.current.set(record.id, record);
      if (executionRecords.current.size > 100) {
        for (const [id, current] of executionRecords.current) {
          if (current.status !== "running" && id !== record.id) {
            executionRecords.current.delete(id);
            break;
          }
        }
      }
      setViewedExecution((current) =>
        current?.id === record.id ? record : current,
      );
      if (record.source !== "mcp") return;
      setAiExecutions((records) => [
        ...records.filter((current) => current.id !== record.id),
        ...(record.status === "running" ? [record] : []),
      ]);
      setConsoleEntries((entries) => {
        const previous = entries.find((entry) => entry.id === record.id);
        const result = record.response;
        const entry: ConsoleEntry = {
          ...previous,
          id: record.id,
          time: new Date(record.startedAt).toLocaleTimeString(),
          method: record.request.method,
          url: previous?.url ?? record.request.url,
          requestHeaders: previous?.requestHeaders ?? [],
          redirects: result?.redirects ?? previous?.redirects ?? [],
          prepared: previous?.prepared ?? false,
          phase:
            record.status === "running"
              ? "pending"
              : record.error
                ? "error"
                : "complete",
          status: result?.status,
          statusText: result?.statusText,
          duration: result?.duration,
          size: result?.size,
          responseHeaders: result?.headers,
          responseBody: result?.body.slice(0, 64 * 1024),
          responseTruncated: result
            ? result.truncated || result.body.length > 64 * 1024
            : undefined,
          responseBinary: result?.binary,
          finalUrl: result?.finalUrl,
          error: record.error ? formatError(record.error) : undefined,
          errorDetail: record.error?.message,
        };
        return previous
          ? entries.map((current) =>
              current.id === record.id ? entry : current,
            )
          : [entry, ...entries].slice(0, 100);
      });
      if (record.status !== "running") {
        void api
          .history()
          .then((entries) => {
            if (!disposed) setHistory(entries);
          })
          .catch((e) => {
            if (!disposed) setError(e);
          });
      }
    };
    void listen<ExecutionRecord>("execution-updated", ({ payload }) =>
      receive(payload),
    )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        /* Older browser bridges have no event subscriptions. */
      });
    void api
      .executions(true)
      .then((records) => {
        if (!disposed) records.forEach(receive);
      })
      .catch(() => {
        /* Older browser bridges do not expose execution records. */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
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
  const tabView = { ...defaultRequestView, ...tab?.view };
  const editor = tabView.requestSection;
  const responseTab = tabView.responseSection;
  const responseFormat = tabView.responseFormat;
  const headerSearch = tabView.headerSearch;
  const {
    value: responseBody,
    invalidJson,
    language: responseLanguage,
  } = useMemo(
    () => responsePresentation(tab?.response, responseTab),
    [tab?.response, responseTab],
  );
  const r = tab?.request;
  // Raw bodies need room for mode controls, editor tools and readable document lines.
  const minEditorHeight = Math.min(
    editor === "Scripts"
      ? 420
      : editor === "Body" && r?.body.mode === "raw"
        ? 380
        : consoleOpen
          ? 240
          : 180,
    maxEditorHeight,
  );
  const editorHeight = Math.max(
    minEditorHeight,
    Math.min(topHeight ?? (mainHeight - tabHeight) * 0.45, maxEditorHeight),
  );
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
  const folderPath = (id: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    let current = w?.items.find((item) => item.id === id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = w?.items.find((item) => item.id === current?.parentId);
    }
    return names.join(" / ");
  };
  const consoleProblems = consoleEntries.filter(
    (entry) => entry.error || (entry.status ?? 0) >= 400,
  ).length;
  const fail = (e: any) => setError(e);
  useEffect(() => {
    api
      .bootstrap()
      .then((b) => {
        drafts.restore(b.drafts);
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
  }, [setWorkspace, drafts]);
  const updateTab = (id: string, p: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.request.id === id ? { ...t, ...p } : t)));
  const setView = (patch: Partial<RequestView>) =>
    setTabs((ts) => patchRequestView(ts, active, patch));
  const setResponseTab = (responseSection: string) =>
    setView({ responseSection });
  const setResponseFormat = (responseFormat: string) =>
    setView({ responseFormat });
  const setHeaderSearch = (headerSearch: string) => setView({ headerSearch });
  const edit = (p: Partial<RequestSpec>) => {
    if (r) {
      const request = { ...r, ...p };
      drafts.stage(request);
      updateTab(r.id, {
        request,
        dirty: true,
        saveState: undefined,
      });
    }
  };
  useEffect(() => {
    for (const tab of tabs) {
      const request = tab.request;
      if (!tab.dirty) {
        drafts.cancel(request.id);
        continue;
      }
      const storedInCollection = !!useWorkspace
        .getState()
        .workspace?.items.some((item) => item.request?.id === request.id);
      const setSaveState = (saveState: Tab["saveState"]) =>
        setTabs((tabs) =>
          tabs.map((tab) =>
            tab.request === request && tab.dirty ? { ...tab, saveState } : tab,
          ),
        );
      drafts.schedule(request, {
        started: () => {
          if (!storedInCollection) setSaveState("saving");
        },
        saved: () => {
          if (!storedInCollection) setSaveState("draft");
        },
        failed: (e) => {
          setSaveState("failed");
          fail(e);
        },
      });
    }
  }, [tabs, drafts]);
  const save = async (target?: SaveTarget) => {
    // A delayed autosave must merge into the latest workspace, not its timer's closure.
    const workspace = useWorkspace.getState().workspace;
    if (!r || !workspace) return;
    const items = [...workspace.items];
    const i = items.findIndex((i) => i.request?.id === r.id);
    let savedItemId = items[i]?.id;
    if (i >= 0) items[i] = { ...items[i], name: r.name, request: r };
    else {
      if (!target) {
        setSaveDestination("");
        setModal("Save request");
        return;
      }
      const c = workspace.collections.find((c) => c.id === target.collectionId);
      const folder = target.parentId
        ? workspace.items.find(
            (item) =>
              item.id === target.parentId &&
              item.kind === "folder" &&
              item.collectionId === target.collectionId,
          )
        : null;
      if (!c || (target.parentId && !folder)) {
        setError("Choose a collection or folder before saving.");
        return;
      }
      savedItemId = crypto.randomUUID();
      items.push({
        id: savedItemId!,
        collectionId: c.id,
        parentId: target.parentId,
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
      await persist({ ...workspace, items });
      if (savedItemId && activeRef.current === r.id) setSelected(savedItemId);
      if (target) setModal("");
      // Editing can continue while persistence is in flight. Preserve any newer draft.
      const current =
        tabsRef.current.find((t) => t.request.id === r.id)?.request ??
        drafts.get(r.id);
      if (current && current !== r) await drafts.save(current);
      else await drafts.remove(r.id);
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
  const activateRequest = (id: string) => {
    setActive(id);
    setSelected(w?.items.find((item) => item.request?.id === id)?.id ?? "");
    setModal("");
  };
  const chooseEditor = (name: string) => {
    setView({ requestSection: name });
  };
  const openRequest = (request: RequestSpec) => {
    const draft = drafts.get(request.id);
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
        { request: draft ?? request, dirty: !!draft },
      ]);
    activateRequest(request.id);
  };
  const viewExecution = async (id: string) => {
    const record = await api.execution(id);
    if (!record) throw new Error(tr("Execution result is unavailable."));
    const cached = executionRecords.current.get(id);
    setViewedExecution(
      record.status === "running" && cached && cached.status !== "running"
        ? cached
        : record,
    );
    setModal("Execution");
  };
  const viewHistory = async (entry: HistoryEntry) => {
    if (entry.response.executionId)
      return viewExecution(entry.response.executionId);
    // Older history entries only retained a body preview and metrics.
    const result = entry.response;
    const timestamp = Date.parse(
      entry.time.includes("T")
        ? entry.time
        : `${entry.time.replace(" ", "T")}Z`,
    );
    setViewedExecution({
      id: `history-${entry.id}`,
      source: result.source ?? "manual",
      environmentId: result.environmentId ?? null,
      environmentName: result.environmentName ?? tr("No environment"),
      startedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
      status: result.error ? "failed" : "completed",
      request: entry.snapshot,
      error: result.error
        ? {
            code: result.error.code ?? "REQUEST_FAILED",
            message: result.error.message ?? tr("Failed"),
          }
        : null,
      response: result.status
        ? {
            status: result.status,
            statusText: "",
            duration: result.duration ?? 0,
            size: result.size ?? 0,
            body: result.body ?? "",
            headers: [],
            contentType: "",
            finalUrl: entry.snapshot.url,
            redirects: [],
            file: "",
            truncated: true,
            binary: false,
          }
        : null,
    });
    setModal("Execution");
  };
  const newTab = () => {
    const request = newRequest();
    drafts.stage(request);
    setTabs((ts) => [...ts, { request, dirty: true }]);
    activateRequest(request.id);
  };
  const addRequest = async (
    collectionId: string,
    parentId: string | null = null,
  ) => {
    if (!w || !w.collections.some((c) => c.id === collectionId)) return;
    const request = newRequest();
    const id = crypto.randomUUID();
    await persist({
      ...w,
      items: [
        ...w.items,
        {
          id,
          collectionId,
          parentId,
          kind: "request",
          name: request.name,
          order: w.items.length,
          auth: { type: "inherit" },
          request,
          metadata: null,
        },
      ],
    });
    setTabs((tabs) => [...tabs, { request, dirty: false }]);
    activateRequest(request.id);
    setSelected(id);
    setSidebarOpen(true);
    setSection("Collections");
    setSearch("");
  };
  const cancelRequest = async (requestId: string) => {
    const execution = activeSends.current.get(requestId);
    if (!execution) return;
    execution.cancelled = true;
    if (execution.started) await api.cancel(execution.id);
  };
  const closeTab = async (id: string) => {
    let closing = tabsRef.current.find((tab) => tab.request.id === id);
    // Input can continue while a slow draft write is in flight.
    while (closing?.dirty) {
      const request = closing.request;
      try {
        await drafts.save(request);
      } catch (error) {
        updateTab(id, { saveState: "failed" });
        throw error;
      }
      closing = tabsRef.current.find((tab) => tab.request.id === id);
      if (closing?.request === request) break;
    }
    await cancelRequest(id);
    activeSends.current.delete(id);
    const currentTabs = tabsRef.current;
    const index = currentTabs.findIndex((tab) => tab.request.id === id);
    setTabs((ts) => ts.filter((t) => t.request.id !== id));
    // The unmounted editor saves its session during cleanup; remove it after that render.
    requestAnimationFrame(() => editorSessions.forgetRequest(id));
    if (activeRef.current === id) {
      activateRequest(
        currentTabs[index + 1]?.request.id ??
          currentTabs[index - 1]?.request.id ??
          "",
      );
    }
  };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<VariableUpdate[]>("script-variables-updated", ({ payload }) => {
      useWorkspace.getState().applyScriptUpdates(payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const send = async () => {
    if (!r || !w || activeSends.current.has(r.id)) return;
    const id = crypto.randomUUID();
    const execution = { id, cancelled: false, started: false };
    activeSends.current.set(r.id, execution);
    // A closed and reopened request has the same request ID but a new execution.
    const updateExecution = (patch: Partial<Tab>) =>
      setTabs((tabs) =>
        tabs.map((tab) =>
          tab.request.id === r.id && tab.execution === id
            ? { ...tab, ...patch }
            : tab,
        ),
      );
    const started = performance.now();
    const request = structuredClone(r);
    const context = executionWorkspace(w, request.id);
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
      responseIsPrevious: !!tab?.response,
    });
    try {
      if (w.items.some((item) => item.request?.id === request.id)) await save();
      else await persist(w);
      if (execution.cancelled)
        throw { code: "REQUEST_CANCELLED", message: "Request cancelled" };
      execution.started = true;
      const result = await api.send(request, id, context);
      // Merge by target/key before Send completes, so the next request freezes fresh values.
      useWorkspace
        .getState()
        .applyScriptUpdates(result.scripts?.variableUpdates ?? []);
      updateExecution({
        response: result,
        responseIsPrevious: false,
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
      updateExecution({ error: e });
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
      if (activeSends.current.get(r.id) === execution)
        activeSends.current.delete(r.id);
      updateExecution({ execution: undefined });
      api.history().then(setHistory).catch(fail);
    }
  };
  const importFile = async () => {
    try {
      const result = await api.import();
      if (result) {
        setWorkspace(result);
        setNotice(
          "Postman data imported. Enable scripts in the Scripts tab before running them.",
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
        if (key === "enter" && !modal) void send();
        if (key === "s" && !modal) void save().catch(fail);
        if (key === "n") newTab();
        if (key === "w") {
          if (modal) setModal("");
          else if (active) void closeTab(active).catch(fail);
        }
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
    requestAnimationFrame(() => {
      for (const id of requestIds) if (id) editorSessions.forgetRequest(id);
    });
    for (const id of requestIds) if (id) await drafts.remove(id);
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
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand" aria-label="LocalPM">
          <span className="brand-icon" aria-hidden="true">
            LP
          </span>
          <strong>LocalPM</strong>
        </div>
        <button
          className="icon-button"
          title={tr(sidebarOpen ? "Hide requests" : "Show requests")}
          aria-label={tr(sidebarOpen ? "Hide requests" : "Show requests")}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Icon name="sidebar" />
        </button>
        <span className="workspace-label">{tr("Local workspace")}</span>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label={tr("Toggle theme")}
            title={tr("Toggle theme")}
            onClick={() =>
              void persist({
                ...w,
                settings: {
                  ...w.settings,
                  theme: resolvedTheme === "dark" ? "light" : "dark",
                },
              }).catch(fail)
            }
          >
            <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} />
          </button>
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
      <McpStatusStrip
        executions={aiExecutions}
        onCancel={(id) => void api.cancelExecution(id).catch(fail)}
        onView={(id) => void viewExecution(id).catch(fail)}
      />
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
          <nav className="resource-navigation" aria-label={tr("Requests")}>
            {["Collections", "History", "Environments"].map((name) => (
              <button
                key={name}
                aria-current={section === name ? "true" : undefined}
                className={section === name ? "active" : ""}
                onClick={() => setSection(name)}
              >
                {tr(name)}
              </button>
            ))}
          </nav>
          <div className="resource-content" hidden={section !== "Collections"}>
            <div className="sidebar-tools">
              <button onClick={createCollection}>{tr("＋ Collection")}</button>
              <button onClick={createFolder}>{tr("＋ Folder")}</button>
              <button
                disabled={!collection}
                title={tr("Select a collection or folder to add a request")}
                onClick={() =>
                  collection &&
                  void addRequest(
                    collection.id,
                    selectedItem?.kind === "folder"
                      ? selectedItem.id
                      : (selectedItem?.parentId ?? null),
                  ).catch(fail)
                }
              >
                {tr("＋ Request")}
              </button>
            </div>
            <CollectionTree
              workspace={w}
              search={search}
              selected={selected}
              onMove={move}
              onAddRequest={(collectionId, parentId) =>
                void addRequest(collectionId, parentId).catch(fail)
              }
              onSelect={(id, item) => {
                setSelected(id);
                setModal("");
                if (item?.request) openRequest(item.request);
              }}
              onEdit={(id, item) => {
                setSelected(id);
                setModal(item ? "Folder" : "Collection");
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
          </div>
          <div className="resource-content" hidden={section !== "Environments"}>
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
          </div>
          <div className="resource-content" hidden={section !== "History"}>
            <HistoryPanel
              history={history}
              onClear={() =>
                void api
                  .clearHistory()
                  .then(() => setHistory([]))
                  .catch(fail)
              }
              onOpen={openRequest}
              onView={(entry) => void viewHistory(entry).catch(fail)}
            />
          </div>
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
            Math.min(420, window.innerWidth - 560),
          )}
          aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={0}
          onDoubleClick={() => {
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
            saveLayout(SIDEBAR_STORAGE_KEY, String(DEFAULT_SIDEBAR_WIDTH));
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
            saveLayout(SIDEBAR_STORAGE_KEY, String(next));
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
            saveLayout(SIDEBAR_STORAGE_KEY, String(next));
            setResizingSidebar(false);
          }}
          onLostPointerCapture={() => setResizingSidebar(false)}
        />
        <main>
          <div
            className={`workspace-body ${resizingEditor ? "resizing-editor" : ""}`}
            ref={mainRef}
          >
            <div className="request-tabs" aria-label={tr("Open requests")}>
              {tabs.map((t) => (
                <div
                  key={t.request.id}
                  className={`tab${active === t.request.id ? " active" : ""}${t.dirty ? " is-dirty" : ""}`}
                >
                  <button
                    title={t.request.name}
                    aria-current={active === t.request.id ? "page" : undefined}
                    aria-label={tr("Request tab: %{name}", {
                      name: t.request.name,
                    })}
                    aria-describedby={
                      t.dirty ? `request-unsaved-${t.request.id}` : undefined
                    }
                    onClick={() => activateRequest(t.request.id)}
                  >
                    <span className="method" data-method={t.request.method}>
                      {t.request.method}
                    </span>{" "}
                    <span className="tab-name">{t.request.name}</span>
                  </button>
                  <button
                    className="tab-close"
                    aria-label={tr("Close tab (draft retained)")}
                    title={tr("Close tab (draft retained)")}
                    onClick={() => void closeTab(t.request.id).catch(fail)}
                  >
                    <Icon name="close" />
                    {t.dirty && (
                      <>
                        <span
                          className="tab-dirty-indicator"
                          aria-hidden="true"
                        />
                        <span
                          className="rare-sr-only"
                          id={`request-unsaved-${t.request.id}`}
                        >
                          {tr("Unsaved changes")}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              ))}
              <button
                className="new-request-tab"
                aria-label={tr("New request")}
                title={tr("New temporary request")}
                onClick={newTab}
              >
                <Icon name="plus" />
                <span>{tr("New request")}</span>
              </button>
            </div>
            {modal === "Execution" && viewedExecution ? (
              <McpExecutionPanel
                key={viewedExecution.id}
                record={viewedExecution}
                onClose={() => setModal("")}
              />
            ) : modal ? (
              <div className="panel">
                <div className="panel-heading">
                  <h2>{tr(modal === "Global" ? "Global variables" : modal)}</h2>
                  <button onClick={() => setModal("")}>{tr("Close ×")}</button>
                </div>
                {modal === "Save request" && r && (
                  <div className="form">
                    <p className="muted">
                      {tr("Choose where to save this temporary request.")}
                    </p>
                    <label>
                      {tr("Request name")}
                      <input
                        value={r.name}
                        onChange={(event) => edit({ name: event.target.value })}
                      />
                    </label>
                    <label>
                      {tr("Save location")}
                      <select
                        aria-label={tr("Save location")}
                        value={saveDestination}
                        onChange={(event) =>
                          setSaveDestination(event.target.value)
                        }
                      >
                        <option value="">
                          {tr("Choose a collection or folder")}
                        </option>
                        {w.collections.map((c) => (
                          <optgroup key={c.id} label={c.name}>
                            <option value={`c:${c.id}`}>{c.name}</option>
                            {w.items
                              .filter(
                                (item) =>
                                  item.kind === "folder" &&
                                  item.collectionId === c.id,
                              )
                              .map((folder) => (
                                <option
                                  key={folder.id}
                                  value={`f:${folder.id}`}
                                >
                                  {folderPath(folder.id)}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    {!w.collections.length && (
                      <button onClick={createCollection}>
                        {tr("＋ Collection")}
                      </button>
                    )}
                    <button
                      className="primary"
                      disabled={!saveDestination || tab?.saveState === "saving"}
                      onClick={() => {
                        const id = saveDestination.slice(2);
                        const folder = saveDestination.startsWith("f:")
                          ? w.items.find((item) => item.id === id)
                          : null;
                        void save({
                          collectionId: folder?.collectionId ?? id,
                          parentId: folder?.id ?? null,
                        }).catch(fail);
                      }}
                    >
                      {tr("Save request")}
                    </button>
                  </div>
                )}
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
                              settings: {
                                ...w.settings,
                                theme: e.target.value,
                              },
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
                    <McpSettings
                      workspace={w}
                      onError={fail}
                      onNotice={setNotice}
                    />
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
                      {tr("appDescription", { version: appVersion })}
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
                    <button
                      onClick={() => void addRequest(collection.id).catch(fail)}
                    >
                      {tr("Add request to collection")}
                    </button>
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
                    <button
                      className="danger"
                      onClick={() => setModal("Delete")}
                    >
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
                    <button
                      onClick={() =>
                        void addRequest(
                          selectedItem.collectionId,
                          selectedItem.id,
                        ).catch(fail)
                      }
                    >
                      {tr("New request in folder")}
                    </button>
                    <button onClick={() => void duplicate().catch(fail)}>
                      {tr("Duplicate folder")}
                    </button>
                    <button
                      className="danger"
                      onClick={() => setModal("Delete")}
                    >
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
                          disabled={
                            w.activeEnvironment === editedEnvironment.id
                          }
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
                      {tr("Delete “%{name}”?", {
                        name: editedEnvironment.name,
                      })}
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
                  <div className="request-identity">
                    <input
                      className="request-name"
                      aria-label={tr("Request name")}
                      value={r.name}
                      onChange={(event) => edit({ name: event.target.value })}
                    />
                    <span
                      className="request-location"
                      title={
                        requestItem
                          ? `${requestCollection?.name} / ${requestItem.parentId ? folderPath(requestItem.parentId) : ""}`
                          : tr("Temporary request")
                      }
                    >
                      {requestItem
                        ? [
                            requestCollection?.name,
                            requestItem.parentId
                              ? folderPath(requestItem.parentId)
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" / ")
                        : tr("Temporary request")}
                    </span>
                    <button onClick={() => void save().catch(fail)}>
                      {tr("Save ⌘S")}
                    </button>
                  </div>
                  <div className="url-bar">
                    <div className="url-field">
                      <MethodSelect
                        key={r.id}
                        value={r.method}
                        onChange={(method) => edit({ method })}
                      />
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
                          ? void cancelRequest(r.id).catch(fail)
                          : void send()
                      }
                    >
                      {tab?.execution && (
                        <span
                          className="sending-indicator"
                          aria-hidden="true"
                        />
                      )}
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
                    <nav
                      className="configuration-navigation"
                      aria-label={tr("Request settings")}
                    >
                      {[
                        "Params",
                        "Headers",
                        "Body",
                        "Authorization",
                        "Scripts",
                      ].map((name) => {
                        const count =
                          name === "Params"
                            ? r.params.filter((p) => p.enabled && p.key).length
                            : name === "Headers"
                              ? r.headers.filter((p) => p.enabled && p.key)
                                  .length
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
                            onClick={() => chooseEditor(name)}
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
                      })}
                    </nav>
                    <div className="request-tools">
                      <span
                        className={`save-status ${tab?.saveState === "failed" ? "save-failed" : tab?.dirty ? "save-unsaved" : ""}`}
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
                      <button
                        className="icon-button"
                        aria-label={tr(
                          editor
                            ? "Collapse configuration"
                            : "Expand configuration",
                        )}
                        title={tr(
                          editor
                            ? "Collapse configuration"
                            : "Expand configuration",
                        )}
                        onClick={() => chooseEditor(editor ? "" : "Params")}
                      >
                        <Icon name={editor ? "chevron-up" : "chevron-down"} />
                      </button>
                      <MoreMenu label={tr("More actions")}>
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
                        <button onClick={() => chooseEditor("Settings")}>
                          {tr("Request settings")}
                        </button>
                      </MoreMenu>
                    </div>
                  </div>
                  <div className="editor-content" hidden={!editor}>
                    {editor === "Settings" && (
                      <div className="advanced-heading">
                        <span>{tr("Request settings")}</span>
                        <button
                          className="icon-button"
                          aria-label={tr("Close configuration")}
                          onClick={() => chooseEditor("")}
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
                      <Auth
                        value={r.auth}
                        onChange={(auth) => edit({ auth })}
                      />
                    )}
                    {editor === "Settings" && (
                      <Network
                        value={r.settings}
                        onChange={(settings) => edit({ settings })}
                      />
                    )}
                    {editor === "Scripts" && (
                      <ScriptEditor
                        requestId={r.id}
                        inherited={inheritedScriptNames(w, r)}
                        inheritedEnabled={
                          readScripts(requestCollection?.metadata).enabled
                        }
                        onInheritedChange={(enabled) => {
                          const workspace = useWorkspace.getState().workspace;
                          if (!workspace || !requestCollection) return;
                          void persist({
                            ...workspace,
                            collections: workspace.collections.map((c) =>
                              c.id === requestCollection.id
                                ? {
                                    ...c,
                                    metadata: {
                                      ...(c.metadata ?? {}),
                                      localpmScripts: {
                                        ...readScripts(c.metadata),
                                        enabled,
                                      },
                                    },
                                  }
                                : c,
                            ),
                          }).catch(fail);
                        }}
                        value={requestScripts(
                          r,
                          requestItem?.metadata,
                          readScripts(requestCollection?.metadata).enabled,
                        )}
                        theme={resolvedTheme}
                        sessions={editorSessions}
                        onChange={(scripts) =>
                          edit({
                            metadata: {
                              ...(r.metadata ?? {}),
                              localpmScripts: scripts,
                            },
                          })
                        }
                      />
                    )}
                    {editor === "Body" && (
                      <>
                        <div className="body-options">
                          <select
                            aria-label={tr("Body mode")}
                            value={r.body.mode}
                            onChange={(e) =>
                              edit({
                                body: { ...r.body, mode: e.target.value },
                              })
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
                              {[
                                "text",
                                "json",
                                "xml",
                                "html",
                                "javascript",
                              ].map((l) => (
                                <option key={l} value={l}>
                                  {l === "text" ? tr("text") : l}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        {r.body.mode === "none" && (
                          <p className="muted">
                            {tr("This request has no body.")}
                          </p>
                        )}
                        {r.body.mode === "raw" && (
                          <CodeEditor
                            key={`${r.id}:body`}
                            stateKey={`${r.id}:body`}
                            sessions={editorSessions}
                            label={tr("Request body editor")}
                            theme={resolvedTheme}
                            value={r.body.raw ?? ""}
                            language={
                              (r.body.options?.raw?.language ??
                                "text") as EditorLanguage
                            }
                            onChange={(raw) =>
                              edit({ body: { ...r.body, raw } })
                            }
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
                            {(r.body.formdata ?? []).map(
                              (p: any, i: number) => (
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
                                                  ? {
                                                      ...f,
                                                      value: e.target.value,
                                                    }
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
                              ),
                            )}
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
                  onDoubleClick={() => setTopHeight(null)}
                  hidden={!editor}
                  role="separator"
                  tabIndex={0}
                  aria-label={tr("Resize request and response")}
                  onLostPointerCapture={() => setResizingEditor(false)}
                  aria-orientation="horizontal"
                  aria-valuemin={minEditorHeight}
                  aria-valuemax={Math.round(maxEditorHeight)}
                  aria-valuenow={Math.round(editorHeight)}
                  onKeyDown={(e) => {
                    if (!["ArrowUp", "ArrowDown", "Home"].includes(e.key))
                      return;
                    e.preventDefault();
                    setTopHeight(
                      e.key === "Home"
                        ? null
                        : Math.max(
                            180,
                            Math.min(
                              maxEditorHeight,
                              editorHeight + (e.key === "ArrowDown" ? 20 : -20),
                            ),
                          ),
                    );
                  }}
                  onPointerDown={(e) => {
                    setResizingEditor(true);
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      setTopHeight(
                        Math.max(
                          180,
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
                          <h3>{tr("Response")}</h3>
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
                            <AnimatedCounter
                              value={tab.response.duration}
                              separator=""
                              duration={0.3}
                            />{" "}
                            {tr("ms")}
                          </span>
                          <span>
                            <AnimatedCounter
                              value={tab.response.size / 1024}
                              decimals={2}
                              separator=""
                              duration={0.3}
                            />{" "}
                            {tr("KB")}
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
                            className={
                              responseTab === "Headers" ? "active" : ""
                            }
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
                                .then(() => setNotice("Response copied."))
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
                      {tab.responseIsPrevious && (
                        <>
                          {" "}
                          · <strong>{tr("Previous response")}</strong>
                        </>
                      )}
                    </div>
                  )}
                  {tab?.execution && tab.response && (
                    <div className="response-context" role="status">
                      {tr(
                        "Sending request… Previous response remains available.",
                      )}
                    </div>
                  )}
                  {!!tab?.error &&
                    (typeof tab.error === "object" &&
                    "code" in tab.error &&
                    tab.error.code === "REQUEST_CANCELLED" ? (
                      <div role="status" className="response-context">
                        {tr("error.REQUEST_CANCELLED")}
                      </div>
                    ) : (
                      <div role="alert" className="error">
                        {formatError(tab.error)}
                        <button onClick={() => setConsoleOpen(true)}>
                          {tr("View diagnostics")}
                        </button>
                      </div>
                    ))}
                  {tab?.response?.scripts && (
                    <ScriptResults report={tab.response.scripts} />
                  )}
                  {invalidJson && (
                    <p className="response-context" role="status">
                      {tr("Invalid JSON; showing the original response.")}
                    </p>
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
                      ) : !responseBody ? (
                        <div className="response-empty">
                          <p>{tr("Empty response body")}</p>
                        </div>
                      ) : responseTab === "Preview" &&
                        tab.response.contentType.includes("html") ? (
                        <iframe
                          title={tr("Isolated response preview")}
                          sandbox=""
                          srcDoc={responseBody}
                        />
                      ) : (
                        <CodeEditor
                          key={`${r.id}:response:${responseTab}`}
                          stateKey={`${r.id}:response:${responseTab}`}
                          sessions={editorSessions}
                          label={tr("Response body editor")}
                          theme={resolvedTheme}
                          value={responseBody}
                          language={responseLanguage}
                          readOnly
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
          </div>
          <div className="workspace-status">
            <button
              aria-expanded={consoleOpen}
              onClick={() => setConsoleOpen(!consoleOpen)}
            >
              {tr("⌘ Console")}
              {consoleProblems > 0 && (
                <span className="console-problem-count">{consoleProblems}</span>
              )}
            </button>
            <span>{tr("Local workspace")}</span>
          </div>
          {consoleOpen && (
            <ConsolePanel
              entries={consoleEntries}
              onClear={() => setConsoleEntries([])}
              onClose={() => setConsoleOpen(false)}
            />
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
    </div>
  );
}
