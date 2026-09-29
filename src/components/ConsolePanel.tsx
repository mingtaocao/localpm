import { useState } from "react";
import { useTranslation } from "react-i18next";

export type ConsoleEntry = {
  id: string;
  time: string;
  method: string;
  url: string;
  requestHeaders: [string, string][];
  status?: number;
  statusText?: string;
  duration: number;
  size?: number;
  responseHeaders?: [string, string][];
  redirects: string[];
  error?: string;
};

type Filter = "all" | "success" | "error";

export function ConsolePanel({
  entries,
  onClear,
}: {
  entries: ConsoleEntry[];
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const visible = entries.filter((entry) =>
    filter === "all" ? true : filter === "error" ? !!entry.error : !entry.error,
  );

  return (
    <section className="console" aria-label={t("Console")}>
      <div className="console-toolbar">
        <strong>{t("Console")}</strong>
        <select
          aria-label={t("Filter console")}
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          <option value="all">{t("All")}</option>
          <option value="success">{t("Success")}</option>
          <option value="error">{t("Errors")}</option>
        </select>
        <span>{t("consoleEntries", { count: visible.length })}</span>
        <button disabled={!entries.length} onClick={onClear}>
          {t("Clear")}
        </button>
      </div>
      <div className="console-list">
        {visible.length ? (
          visible.map((entry) => (
            <details
              className={`console-entry ${entry.error ? "console-entry-error" : ""}`}
              key={entry.id}
            >
              <summary>
                <time>{entry.time}</time>
                <b className="method">{entry.method}</b>
                <span className="console-url" title={entry.url}>
                  {entry.url}
                </span>
                {entry.error ? (
                  <b className="console-failed">{t("Failed")}</b>
                ) : (
                  <b>{entry.status}</b>
                )}
                <span>{entry.duration} ms</span>
              </summary>
              <div className="console-details">
                <div>
                  <h4>{t("Request")}</h4>
                  <p>
                    <b>{entry.method}</b> {entry.url}
                  </p>
                  <HeaderList
                    empty={t("No request headers")}
                    headers={entry.requestHeaders}
                  />
                </div>
                <div>
                  <h4>{entry.error ? t("Error") : t("Response")}</h4>
                  {entry.error ? (
                    <p className="console-failed">{entry.error}</p>
                  ) : (
                    <>
                      <p>
                        {entry.status} {entry.statusText} · {entry.duration} ms ·{" "}
                        {entry.size ?? 0} B
                      </p>
                      <HeaderList
                        empty={t("No response headers")}
                        headers={entry.responseHeaders ?? []}
                      />
                    </>
                  )}
                  {!!entry.redirects.length && (
                    <>
                      <h4>{t("Redirects")}</h4>
                      <ol>
                        {entry.redirects.map((url, index) => (
                          <li key={`${url}-${index}`}>{url}</li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              </div>
            </details>
          ))
        ) : (
          <div className="console-empty">
            {entries.length
              ? t("No console entries match this filter.")
              : t("No requests sent this session.")}
          </div>
        )}
      </div>
    </section>
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
