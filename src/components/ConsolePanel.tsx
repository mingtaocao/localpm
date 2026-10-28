import { useEffect, useState, type PointerEvent } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { layoutNumber, saveLayout } from "../stores/layout";
import type { ScriptReport } from "../types";
import { ScriptResults } from "./ScriptResults";
import { useTranslation } from "react-i18next";

export type RequestDiagnostic = {
  id: string;
  method: string;
  url: string;
  headers: [string, string][];
  bodyPreview?: string | null;
  bodySize?: number | null;
  bodyMode?: string;
  proxyMode: string;
  proxyUrl?: string | null;
  proxyBypassed: boolean;
  timeout: number;
  verifyTls: boolean;
};

export type ConsoleEntry = {
  scripts?: ScriptReport | null;
  id: string;
  time: string;
  method: string;
  url: string;
  requestHeaders: [string, string][];
  redirects: string[];
  prepared: boolean;
  phase: "pending" | "complete" | "error";
  bodyPreview?: string | null;
  bodySize?: number | null;
  bodyMode?: string;
  proxyMode?: string;
  proxyUrl?: string | null;
  proxyBypassed?: boolean;
  timeout?: number;
  verifyTls?: boolean;
  status?: number;
  statusText?: string;
  duration?: number;
  size?: number;
  responseHeaders?: [string, string][];
  responseBody?: string;
  responseTruncated?: boolean;
  responseBinary?: boolean;
  finalUrl?: string;
  error?: string;
  errorDetail?: string;
};

const CONSOLE_HEIGHT_KEY = "localpm-console-height";
const DEFAULT_CONSOLE_HEIGHT = 260;
const MIN_CONSOLE_HEIGHT = 160;
// Keep the 180px editor, 160px response, tabs and divider usable at minimum size.
function maxConsoleHeight() {
  return Math.max(
    MIN_CONSOLE_HEIGHT,
    Math.min(
      (window.innerHeight - 48) * 0.7,
      window.innerHeight -
        48 -
        (window.innerHeight >= 720 ? 240 : 194) -
        160 -
        38 -
        1 -
        32,
    ),
  );
}

function clampConsoleHeight(height: number) {
  return Math.min(Math.max(height, MIN_CONSOLE_HEIGHT), maxConsoleHeight());
}

export function ConsolePanel({
  entries,
  onClear,
  onClose,
}: {
  entries: ConsoleEntry[];
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyFeedback();
  const [copyError, setCopyError] = useState<string | null>(null);
  const [height, setHeight] = useState(() => {
    const saved = layoutNumber(CONSOLE_HEIGHT_KEY, DEFAULT_CONSOLE_HEIGHT);
    return clampConsoleHeight(saved > 0 ? saved : DEFAULT_CONSOLE_HEIGHT);
  });
  const [dragging, setDragging] = useState(false);
  const [maxHeight, setMaxHeight] = useState(maxConsoleHeight);
  useEffect(() => {
    const onResize = () => setMaxHeight(maxConsoleHeight());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const visibleHeight = Math.min(height, maxHeight);
  const setSavedHeight = (nextHeight: number) => {
    const clamped = clampConsoleHeight(nextHeight);
    setHeight(clamped);
    saveLayout(CONSOLE_HEIGHT_KEY, String(clamped));
  };
  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      setHeight(clampConsoleHeight(window.innerHeight - event.clientY));
    }
  };
  const onResizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    setSavedHeight(window.innerHeight - event.clientY);
  };

  return (
    <section
      className={`console ${dragging ? "console-dragging" : ""}`}
      style={{ height: visibleHeight }}
      aria-label={t("Console")}
    >
      <div
        className="console-resizer"
        role="separator"
        tabIndex={0}
        aria-label={t("Resize console")}
        aria-orientation="horizontal"
        aria-valuemin={MIN_CONSOLE_HEIGHT}
        aria-valuemax={maxHeight}
        aria-valuenow={visibleHeight}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
        onDoubleClick={() => {
          setSavedHeight(DEFAULT_CONSOLE_HEIGHT);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setSavedHeight(
              visibleHeight + (event.key === "ArrowUp" ? 30 : -30),
            );
          } else if (event.key === "Home") {
            event.preventDefault();
            setSavedHeight(DEFAULT_CONSOLE_HEIGHT);
          }
        }}
      />
      <div className="console-toolbar">
        <strong>{t("Console")}</strong>
        <button disabled={!entries.length} onClick={onClear}>
          {t("Clear")}
        </button>
        <button aria-label={t("Close console")} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="console-list">
        {entries.length ? (
          entries.map((entry) => {
            const problem = !!entry.error || (entry.status ?? 0) >= 400;
            return (
              <details
                className={`console-entry ${problem ? "console-entry-error" : ""}`}
                key={entry.id}
              >
                <summary>
                  <b className="method" data-method={entry.method}>
                    {entry.method}
                  </b>
                  <span className="console-url" title={entry.url}>
                    {entry.url}
                  </span>
                  <b
                    title={t("Status")}
                    className={problem ? "console-failed" : ""}
                  >
                    {entry.phase === "pending"
                      ? t("Sending")
                      : entry.error
                        ? t("Failed")
                        : entry.status}
                  </b>
                  <span title={t("Duration")}>
                    {entry.duration === undefined
                      ? "…"
                      : `${entry.duration} ms`}
                  </span>
                  <span title={t("Size")}>
                    {entry.size === undefined
                      ? "—"
                      : `${(entry.size / 1024).toFixed(2)} KB`}
                  </span>
                  <time title={t("Timestamp")}>{entry.time}</time>
                </summary>
                <div className="console-details">
                  <ScriptResults report={entry.scripts} />
                  <div className="console-detail-toolbar">
                    <span>
                      {entry.prepared
                        ? t("Built request")
                        : t("Request preparation pending or failed")}
                    </span>
                    <button
                      onClick={() => {
                        setCopyError(null);
                        void copy(
                          JSON.stringify(entry, null, 2),
                          entry.id,
                        ).catch(() => setCopyError(entry.id));
                      }}
                    >
                      {copied === entry.id
                        ? t("Copied")
                        : t("Copy diagnostics")}
                    </button>
                  </div>
                  {copyError === entry.id && (
                    <p role="alert" className="console-failed">
                      {t("Copy failed")}
                    </p>
                  )}
                  <h4>{t("General")}</h4>
                  <dl className="console-general">
                    {[
                      [t("Request URL"), entry.url],
                      [t("Method"), entry.method],
                      [
                        t("Status"),
                        entry.error ?? entry.status ?? t("Sending"),
                      ],
                      [
                        t("Duration"),
                        entry.duration === undefined
                          ? "—"
                          : `${entry.duration} ms`,
                      ],
                      [t("Timestamp"), entry.time],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="console-columns">
                    <div>
                      <h4>{t("Request")}</h4>
                      {entry.prepared && (
                        <>
                          <h5>{t("Headers")}</h5>
                          <HeaderList
                            headers={entry.requestHeaders}
                            empty={t("No request headers")}
                          />
                          <h5>{t("Body")}</h5>
                          {entry.bodySize != null && (
                            <small>{entry.bodySize} B</small>
                          )}
                          <BodyPreview
                            body={entry.bodyPreview}
                            binary={entry.bodyPreview === null}
                            truncated={
                              entry.bodySize !== undefined &&
                              entry.bodySize !== null &&
                              entry.bodySize > 64 * 1024
                            }
                            empty={
                              entry.bodyMode && entry.bodyMode !== "none"
                                ? t(
                                    "Streaming body or file; bytes are not buffered for Console.",
                                  )
                                : t("No request body")
                            }
                          />
                        </>
                      )}
                    </div>
                    <div>
                      <h4>{entry.error ? t("Error") : t("Response")}</h4>
                      {entry.error ? (
                        <>
                          <p className="console-failed">{entry.error}</p>
                          {entry.errorDetail &&
                            entry.errorDetail !== entry.error && (
                              <pre>{entry.errorDetail}</pre>
                            )}
                        </>
                      ) : entry.phase === "pending" ? (
                        <p>{t("Sending")}</p>
                      ) : (
                        <>
                          <p className="console-response-metrics">
                            <b className={problem ? "console-failed" : ""}>
                              {entry.status} {entry.statusText}
                            </b>{" "}
                            <span>{entry.duration} ms</span>
                            <span>{entry.size ?? 0} B</span>
                          </p>
                          {entry.finalUrl && entry.finalUrl !== entry.url && (
                            <p>
                              {t("Final URL")}: {entry.finalUrl}
                            </p>
                          )}
                          <h5>{t("Headers")}</h5>
                          <HeaderList
                            headers={entry.responseHeaders ?? []}
                            empty={t("No response headers")}
                          />
                          <h5>{t("Body")}</h5>
                          <BodyPreview
                            body={entry.responseBody}
                            binary={!!entry.responseBinary}
                            truncated={!!entry.responseTruncated}
                            empty={t("No response body")}
                          />
                        </>
                      )}
                      {!!entry.redirects.length && (
                        <>
                          <h5>{t("Redirect endpoints")}</h5>
                          <ol>
                            {entry.redirects.map((url, index) => (
                              <li key={`${url}-${index}`}>{url}</li>
                            ))}
                          </ol>
                        </>
                      )}
                    </div>
                  </div>
                  {entry.prepared && (
                    <div className="console-network">
                      <h4>{t("Network")}</h4>
                      <span>
                        {t("Route")}: {entry.proxyMode}
                        {entry.proxyUrl ? `, ${entry.proxyUrl}` : ""}
                        {entry.proxyBypassed ? `, ${t("No Proxy bypass")}` : ""}
                      </span>
                      <span>
                        {t("Timeout")}: {entry.timeout} ms
                      </span>
                      <span>
                        {t("Certificate verification")}:{" "}
                        {entry.verifyTls ? t("On") : t("Off")}
                      </span>
                    </div>
                  )}
                  <small className="console-note">
                    {t(
                      "Request headers reflect the built request. Client cookies and transport headers may be added when sending.",
                    )}
                  </small>
                </div>
              </details>
            );
          })
        ) : (
          <div className="console-empty">
            {t("No requests sent this session.")}
          </div>
        )}
      </div>
    </section>
  );
}

function BodyPreview({
  body,
  binary,
  truncated,
  empty,
}: {
  body?: string | null;
  binary: boolean;
  truncated: boolean;
  empty: string;
}) {
  const { t } = useTranslation();
  if (binary) return <p className="muted">{empty}</p>;
  if (!body) return <p className="muted">{empty}</p>;
  const visible = body.slice(0, 64 * 1024);
  return (
    <>
      <pre className="console-body">{visible}</pre>
      {(truncated || body.length > visible.length) && (
        <small>
          {t("Preview truncated; save response for complete body.")}
        </small>
      )}
    </>
  );
}

function HeaderList({
  headers,
  empty,
}: {
  headers: [string, string][];
  empty: string;
}) {
  if (!headers.length) return <p className="muted">{empty}</p>;
  return (
    <dl className="console-headers">
      {headers.map(([name, value], index) => (
        <div key={`${name}-${index}`}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
