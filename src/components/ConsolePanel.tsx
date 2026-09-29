import { useMemo, useState } from "react";
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

type Filter = "all" | "http" | "network";

export function ConsolePanel({
  entries,
  onClear,
}: {
  entries: ConsoleEntry[];
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(
    () => entries.filter((entry) => {
      if (filter === "http" && !(entry.status && entry.status >= 400)) return false;
      if (filter === "network" && !entry.error) return false;
      return `${entry.method} ${entry.url} ${entry.status ?? ""} ${entry.error ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase());
    }),
    [entries, filter, query],
  );

  return (
    <section className={`console ${expanded ? "console-expanded" : ""}`} aria-label={t("Console")}>
      <div className="console-toolbar">
        <strong>{t("Console")}</strong>
        <input
          aria-label={t("Search console")}
          placeholder={t("Search URL, status or error")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label={t("Filter console")}
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          <option value="all">{t("All")}</option>
          <option value="http">{t("HTTP errors")}</option>
          <option value="network">{t("Network errors")}</option>
        </select>
        <span>{t("consoleEntries", { count: visible.length })}</span>
        <button onClick={() => setExpanded(!expanded)}>{expanded ? t("Restore") : t("Expand")}</button>
        <button disabled={!entries.length} onClick={onClear}>{t("Clear")}</button>
      </div>
      <div className="console-list">
        {visible.length ? visible.map((entry) => {
          const problem = !!entry.error || (entry.status ?? 0) >= 400;
          return (
            <details className={`console-entry ${problem ? "console-entry-error" : ""}`} key={entry.id}>
              <summary>
                <time>{entry.time}</time>
                <b className="method">{entry.method}</b>
                <span className="console-url" title={entry.url}>{entry.url}</span>
                <b className={problem ? "console-failed" : ""}>
                  {entry.phase === "pending" ? t("Sending") : entry.error ? t("Failed") : entry.status}
                </b>
                <span>{entry.duration === undefined ? "…" : `${entry.duration} ms`}</span>
              </summary>
              <div className="console-details">
                <div className="console-detail-toolbar">
                  <span>{entry.prepared ? t("Built request") : t("Request preparation pending or failed")}</span>
                  <button onClick={() => void navigator.clipboard.writeText(JSON.stringify(entry, null, 2))}>
                    {t("Copy diagnostics")}
                  </button>
                </div>
                <div className="console-columns">
                  <div>
                    <h4>{t("Request")}</h4>
                    <p className="console-address"><b>{entry.method}</b> {entry.url}</p>
                    {entry.prepared && (
                      <>
                        <h5>{t("Headers")}</h5>
                        <HeaderList headers={entry.requestHeaders} empty={t("No request headers")} />
                        <h5>{t("Body")}</h5>
                        <BodyPreview
                          body={entry.bodyPreview}
                          binary={entry.bodyPreview === null}
                          truncated={entry.bodySize !== undefined && entry.bodySize !== null && entry.bodySize > 64 * 1024}
                          empty={entry.bodyMode && entry.bodyMode !== "none" ? t("Streaming body or file; bytes are not buffered for Console.") : t("No request body")}
                        />
                      </>
                    )}
                  </div>
                  <div>
                    <h4>{entry.error ? t("Error") : t("Response")}</h4>
                    {entry.error ? (
                      <>
                        <p className="console-failed">{entry.error}</p>
                        {entry.errorDetail && entry.errorDetail !== entry.error && <pre>{entry.errorDetail}</pre>}
                      </>
                    ) : entry.phase === "pending" ? <p>{t("Sending")}</p> : (
                      <>
                        <p><b className={problem ? "console-failed" : ""}>{entry.status} {entry.statusText}</b> · {entry.duration} ms · {entry.size ?? 0} B</p>
                        {entry.finalUrl && entry.finalUrl !== entry.url && <p>{t("Final URL")}: {entry.finalUrl}</p>}
                        <h5>{t("Headers")}</h5>
                        <HeaderList headers={entry.responseHeaders ?? []} empty={t("No response headers")} />
                        <h5>{t("Body")}</h5>
                        <BodyPreview body={entry.responseBody} binary={!!entry.responseBinary} truncated={!!entry.responseTruncated} empty={t("No response body")} />
                      </>
                    )}
                    {!!entry.redirects.length && (
                      <>
                        <h5>{t("Redirect endpoints")}</h5>
                        <ol>{entry.redirects.map((url, index) => <li key={`${url}-${index}`}>{url}</li>)}</ol>
                      </>
                    )}
                  </div>
                </div>
                {entry.prepared && (
                  <div className="console-network">
                    <h4>{t("Network")}</h4>
                    <span>{t("Route")}: {entry.proxyMode}{entry.proxyUrl ? ` · ${entry.proxyUrl}` : ""}{entry.proxyBypassed ? ` · ${t("No Proxy bypass")}` : ""}</span>
                    <span>{t("Timeout")}: {entry.timeout} ms</span>
                    <span>{t("Certificate verification")}: {entry.verifyTls ? t("On") : t("Off")}</span>
                  </div>
                )}
                <small className="console-note">{t("Request headers reflect the built request. Client cookies and transport headers may be added when sending.")}</small>
              </div>
            </details>
          );
        }) : (
          <div className="console-empty">
            {entries.length ? t("No console entries match this filter.") : t("No requests sent this session.")}
          </div>
        )}
      </div>
    </section>
  );
}

function BodyPreview({body, binary, truncated, empty}: {body?: string | null; binary: boolean; truncated: boolean; empty: string}) {
  const { t } = useTranslation();
  if (binary) return <p className="muted">{empty}</p>;
  if (!body) return <p className="muted">{empty}</p>;
  const visible = body.slice(0, 64 * 1024);
  return (
    <>
      <pre className="console-body">{visible}</pre>
      {(truncated || body.length > visible.length) && <small>{t("Preview truncated; save response for complete body.")}</small>}
    </>
  );
}

function HeaderList({headers, empty}: {headers: [string, string][]; empty: string}) {
  if (!headers.length) return <p className="muted">{empty}</p>;
  return (
    <dl className="console-headers">
      {headers.map(([name, value], index) => (
        <div key={`${name}-${index}`}><dt>{name}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}
