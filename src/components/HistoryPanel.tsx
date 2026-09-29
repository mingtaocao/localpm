import { useTranslation } from "react-i18next";
import type { HistoryEntry, RequestSpec } from "../types";

export function HistoryPanel({
  history,
  onClear,
  onOpen,
}: {
  history: HistoryEntry[];
  onClear: () => void;
  onOpen: (request: RequestSpec) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <div className="history-list">
      <button onClick={onClear}>{tr("Clear history")}</button>
      {history.map((entry) => (
        <button
          key={entry.id}
          className="history-item"
          onClick={() =>
            onOpen({
              ...entry.snapshot,
              id: crypto.randomUUID(),
              name: tr("History · %{name}", { name: entry.snapshot.name }),
            })
          }
        >
          <span className="method">{entry.snapshot.method}</span>
          <b>{entry.response.status ?? entry.response.error?.code}</b>
          <span>{entry.snapshot.url}</span>
          <small>{entry.time}</small>
        </button>
      ))}
    </div>
  );
}
