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
  const { t: tr } = useTranslation();
  return (
    <div className="history-list">
      <button onClick={onClear}>{tr("Clear history")}</button>
      {history.map((entry) => (
        <div className="history-record" key={entry.id}>
          <button
            className="history-item"
            title={entry.snapshot.url}
            onClick={() =>
              onOpen({
                ...entry.snapshot,
                id: crypto.randomUUID(),
                name: tr("History · %{name}", { name: entry.snapshot.name }),
              })
            }
          >
            <span className="method" data-method={entry.snapshot.method}>
              {entry.snapshot.method}
            </span>
            <b>{entry.response.status ?? entry.response.error?.code}</b>
            <span>{entry.snapshot.url}</span>
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
              <time title={entry.time}>{entry.time}</time>
            </small>
          </button>
          {onView && (
            <button
              className="history-view"
              aria-label={tr("View result for %{name}", {
                name: entry.snapshot.name,
              })}
              onClick={() => onView(entry)}
            >
              {tr("View result")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
