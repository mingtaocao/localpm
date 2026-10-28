import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { HistoryEntry, RequestSpec } from "../types";

export function HistoryPanel({
  history,
  onClear,
  onOpen,
  onView,
}: {
  history: HistoryEntry[];
  onClear: () => void;
  onOpen: (request: RequestSpec) => void;
  onView?: (entry: HistoryEntry) => void;
}) {
  const { t: tr, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const filtered = history.filter((entry) =>
    `${entry.snapshot.name} ${entry.snapshot.method} ${entry.snapshot.url} ${entry.response.status ?? entry.response.error?.code ?? ""} ${entry.response.environmentName ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const groups = new Map<string, HistoryEntry[]>();
  const timestamp = (entry: HistoryEntry) =>
    new Date(
      entry.time.includes("T")
        ? entry.time
        : `${entry.time.replace(" ", "T")}Z`,
    );
  const locale = i18n.resolvedLanguage;
  for (const entry of filtered) {
    const time = timestamp(entry);
    const day = Number.isNaN(time.getTime())
      ? entry.time
      : time.toLocaleDateString(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
    const entries = groups.get(day) ?? [];
    entries.push(entry);
    groups.set(day, entries);
  }
  const open = (entry: HistoryEntry) =>
    onOpen({
      ...entry.snapshot,
      id: crypto.randomUUID(),
      name: tr("History: %{name}", { name: entry.snapshot.name }),
    });
  return (
    <div className="history-list">
      <div className="history-toolbar">
        <input
          aria-label={tr("Search history")}
          placeholder={tr("Search history")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="subtle" disabled={!history.length} onClick={onClear}>
          {tr("Clear history")}
        </button>
      </div>
      {[...groups].map(([day, entries]) => (
        <section className="history-day" key={day}>
          <h3>{day}</h3>
          {entries.map((entry) => {
            const time = timestamp(entry);
            return (
              <div className="history-record" key={entry.id}>
                <button
                  className="history-item"
                  title={entry.snapshot.url}
                  aria-label={
                    onView
                      ? tr("View result for %{name}", {
                          name: entry.snapshot.name,
                        })
                      : undefined
                  }
                  onClick={() => (onView ? onView(entry) : open(entry))}
                >
                  <span className="history-summary">
                    <span
                      className="method"
                      data-method={entry.snapshot.method}
                    >
                      {entry.snapshot.method}
                    </span>
                    <span
                      className={`history-status ${(entry.response.status ?? 0) >= 400 || entry.response.error ? "status-error" : ""}`}
                    >
                      {entry.response.status ?? entry.response.error?.code}
                    </span>
                    <time dateTime={entry.time} title={entry.time}>
                      {Number.isNaN(time.getTime())
                        ? entry.time
                        : time.toLocaleTimeString(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                    </time>
                  </span>
                  <strong>{entry.snapshot.name}</strong>
                  <span className="history-url">{entry.snapshot.url}</span>
                  {(entry.response.source === "mcp" ||
                    entry.response.environmentName) && (
                    <small>
                      {entry.response.source === "mcp" && (
                        <em className="execution-source">{tr("AI")}</em>
                      )}
                      {entry.response.environmentName && (
                        <span className="history-environment">
                          {entry.response.environmentId === null
                            ? tr("No environment")
                            : entry.response.environmentName}
                        </span>
                      )}
                    </small>
                  )}
                </button>
                {onView && (
                  <button
                    className="history-view"
                    aria-label={tr("Open %{name} as a new request", {
                      name: entry.snapshot.name,
                    })}
                    onClick={() => open(entry)}
                  >
                    {tr("Open as new request")}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      ))}
      {!filtered.length && (
        <p className="empty-small">
          {tr(
            history.length ? "No matching history." : "No request history yet.",
          )}
        </p>
      )}
    </div>
  );
}
