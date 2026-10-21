import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import type { RequestTab } from "../stores/requestTabs";
import { platformShortcut } from "../utils/shortcuts";
import { Icon } from "./Icon";

export function RequestTabs({
  tabs,
  active,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: RequestTab[];
  active: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const { t: tr } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const [scroll, setScroll] = useState({
    overflow: false,
    start: true,
    end: true,
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const filtered = tabs.filter(({ request }) =>
    `${request.name} ${request.method} ${request.url}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const selected = Math.min(cursor, Math.max(0, filtered.length - 1));

  const measure = () => {
    const el = list.current;
    if (el)
      setScroll({
        overflow: el.scrollWidth > el.clientWidth + 1,
        start: el.scrollLeft <= 1,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
  };
  const revealActive = () => {
    const el = list.current;
    const tab = track.current?.querySelector<HTMLElement>(".tab.active");
    if (!el || !tab) return;
    const viewport = el.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    if (bounds.left < viewport.left)
      el.scrollLeft += bounds.left - viewport.left;
    else if (bounds.right > viewport.right)
      el.scrollLeft += bounds.right - viewport.right;
  };
  useLayoutEffect(() => {
    revealActive();
    measure();
  }, [active, tabs.length, scroll.overflow]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      revealActive();
      measure();
    });
    if (list.current) observer.observe(list.current);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    // The minimum supported macOS WebView predates native modal dialogs.
    const previousFocus = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById("root");
    const previousHidden = appRoot?.getAttribute("aria-hidden");
    search.current?.focus();
    appRoot?.setAttribute("aria-hidden", "true");
    const containFocus = (event: FocusEvent) => {
      if (!dialog.current?.contains(event.target as Node))
        search.current?.focus();
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (previousHidden == null) appRoot?.removeAttribute("aria-hidden");
      else appRoot?.setAttribute("aria-hidden", previousHidden);
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    resultList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, query, open]);

  function showSwitcher() {
    setQuery("");
    setCursor(
      Math.max(
        0,
        tabs.findIndex((tab) => tab.request.id === active),
      ),
    );
    setOpen(true);
  }
  function selectRequest(id: string) {
    onActivate(id);
    setOpen(false);
  }
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
        return;
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        showSwitcher();
      } else if (
        !open &&
        tabs.length > 0 &&
        ["PageUp", "PageDown"].includes(event.key)
      ) {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.request.id === active);
        const next =
          (index + (event.key === "PageDown" ? 1 : -1) + tabs.length) %
          tabs.length;
        onActivate(tabs[next].request.id);
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });

  return (
    <nav className="request-tabs" aria-label={tr("Open requests")}>
      <button
        className="icon-button tab-scroll"
        hidden={!scroll.overflow}
        disabled={scroll.start}
        aria-label={tr("Scroll tabs left")}
        title={tr("Scroll tabs left")}
        onClick={() =>
          list.current?.scrollBy({ left: -list.current.clientWidth * 0.7 })
        }
      >
        <Icon name="chevron-left" />
      </button>
      <div className="request-tab-list" ref={list} onScroll={measure}>
        <div className="request-tab-track" ref={track}>
          {tabs.map((tab, index) => (
            <div
              key={tab.request.id}
              className={`tab${active === tab.request.id ? " active" : ""}${tab.dirty ? " is-dirty" : ""}`}
            >
              <button
                title={`${tab.request.name}\n${tab.request.method} ${tab.request.url}`}
                aria-label={tr("Request tab: %{name}", {
                  name: tab.request.name,
                })}
                aria-current={active === tab.request.id ? "page" : undefined}
                aria-describedby={
                  tab.dirty ? `request-unsaved-${tab.request.id}` : undefined
                }
                onClick={() => onActivate(tab.request.id)}
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                          tabs.length;
                  onActivate(tabs[next].request.id);
                  track.current?.children[next]
                    ?.querySelector("button")
                    ?.focus({ preventScroll: true });
                }}
              >
                <span className="method" data-method={tab.request.method}>
                  {tab.request.method}
                </span>
                <span className="tab-name">{tab.request.name}</span>
              </button>
              <button
                className="tab-close"
                aria-label={tr("Close request: %{name}", {
                  name: tab.request.name,
                })}
                title={tr("Close tab (draft retained)")}
                onClick={() => onClose(tab.request.id)}
              >
                <Icon name="close" />
                {tab.dirty && (
                  <span
                    className="tab-dirty-indicator"
                    id={`request-unsaved-${tab.request.id}`}
                    title={tr("Unsaved changes")}
                  >
                    <span className="rare-sr-only">
                      {tr("Unsaved changes")}
                    </span>
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
      <button
        className="icon-button tab-scroll"
        hidden={!scroll.overflow}
        disabled={scroll.end}
        aria-label={tr("Scroll tabs right")}
        title={tr("Scroll tabs right")}
        onClick={() =>
          list.current?.scrollBy({ left: list.current.clientWidth * 0.7 })
        }
      >
        <Icon name="chevron-right" />
      </button>
      <div className="request-tab-actions">
        <button
          className="new-request-tab"
          aria-label={tr("New request")}
          title={`${tr("New temporary request")} (${platformShortcut("N")})`}
          onClick={onNew}
        >
          <Icon name="plus" />
          <span>{tr("New request")}</span>
        </button>
        <button
          className="request-switcher-trigger"
          aria-label={tr("Find open request")}
          title={`${tr("Find open request")} (${platformShortcut("P")})`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={showSwitcher}
        >
          <Icon name="chevron-down" />
          <span>{tabs.length}</span>
        </button>
      </div>
      {open &&
        createPortal(
          <div
            className="request-switcher-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              className="request-switcher"
              aria-label={tr("Switch request")}
              onKeyDownCapture={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  return;
                }
                if (event.key === "Tab") {
                  const focusable =
                    dialog.current?.querySelectorAll<HTMLElement>(
                      "button, input",
                    );
                  const first = focusable?.[0];
                  const last = focusable?.[focusable.length - 1];
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                  } else if (
                    !event.shiftKey &&
                    document.activeElement === last
                  ) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
                if (!(event.metaKey || event.ctrlKey)) return;
                const key = event.key.toLowerCase();
                if (
                  [
                    "p",
                    "w",
                    "s",
                    "n",
                    "k",
                    ",",
                    "enter",
                    "pageup",
                    "pagedown",
                  ].includes(key)
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (key === "w") setOpen(false);
                }
              }}
            >
              <div className="request-switcher-heading">
                <h2>{tr("Switch request")}</h2>
                <span>{tr("openRequests", { count: tabs.length })}</span>
                <button
                  className="icon-button"
                  aria-label={tr("Close request switcher")}
                  onClick={() => setOpen(false)}
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="request-switcher-search">
                <Icon name="search" />
                <input
                  ref={search}
                  role="combobox"
                  aria-expanded="true"
                  aria-autocomplete="list"
                  aria-controls={resultsId}
                  aria-activedescendant={
                    filtered.length ? `${resultsId}-${selected}` : undefined
                  }
                  aria-label={tr("Search open requests")}
                  placeholder={tr("Search by name, method or URL")}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setCursor(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (
                      ["ArrowDown", "ArrowUp", "Home", "End"].includes(
                        event.key,
                      ) &&
                      (!event.key.startsWith("Arrow")
                        ? event.ctrlKey || event.metaKey
                        : true)
                    ) {
                      event.preventDefault();
                      setCursor(
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? Math.max(0, filtered.length - 1)
                            : filtered.length
                              ? (selected +
                                  (event.key === "ArrowDown" ? 1 : -1) +
                                  filtered.length) %
                                filtered.length
                              : 0,
                      );
                    }
                    if (event.key === "Enter" && filtered[selected]) {
                      event.preventDefault();
                      selectRequest(filtered[selected].request.id);
                    }
                  }}
                />
                <kbd>Esc</kbd>
              </div>
              <div
                className="request-switcher-results"
                role="listbox"
                aria-label={tr("Open requests")}
                id={resultsId}
                ref={resultList}
              >
                {filtered.map((tab, index) => (
                  <div
                    key={tab.request.id}
                    role="option"
                    aria-selected={selected === index}
                    id={`${resultsId}-${index}`}
                    className="request-switcher-result"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectRequest(tab.request.id)}
                  >
                    <span className="method" data-method={tab.request.method}>
                      {tab.request.method}
                    </span>
                    <span className="request-switcher-identity">
                      <strong>{tab.request.name}</strong>
                      <small>{tab.request.url || tr("No URL yet")}</small>
                    </span>
                    {tab.dirty && (
                      <span
                        className="tab-dirty-indicator"
                        title={tr("Unsaved changes")}
                      >
                        <span className="rare-sr-only">
                          {tr("Unsaved changes")}
                        </span>
                      </span>
                    )}
                    {tab.request.id === active && (
                      <span className="request-switcher-current">
                        <Icon name="check" />
                        <span className="rare-sr-only">
                          {tr("Current request")}
                        </span>
                      </span>
                    )}
                  </div>
                ))}
                {!filtered.length && (
                  <p className="request-switcher-empty" role="status">
                    {tr(
                      tabs.length
                        ? "No open requests match your search."
                        : "No open requests. Create one to get started.",
                    )}
                  </p>
                )}
              </div>
              <div className="request-switcher-footer">
                <span>
                  <kbd>↑</kbd> <kbd>↓</kbd> {tr("Navigate")}
                </span>
                <span>
                  <kbd>↵</kbd> {tr("Open request")}
                </span>
                <kbd>{platformShortcut("P")}</kbd>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </nav>
  );
}
