import { useTranslation } from "react-i18next";
import type { ExecutionRecord } from "../types";

export function McpStatusStrip({
  executions,
  onCancel,
  onView,
}: {
  executions: ExecutionRecord[];
  onCancel: (id: string) => void;
  onView: (id: string) => void;
}) {
  const { t: tr } = useTranslation();
  const active = executions.filter(
    (record) => record.source === "mcp" && record.status === "running",
  );
  if (!active.length) return null;
  return (
    <section className="mcp-status-strip" aria-label={tr("AI executions")}>
      {active.map((record) => (
        <div className="mcp-status-row" key={record.id}>
          <span className="execution-source">{tr("AI")}</span>
          <span className="mcp-running">{tr("Sending request…")}</span>
          <button
            className="mcp-running-name"
            aria-label={tr("View AI result for %{name}", {
              name: record.request.name,
            })}
            onClick={() => onView(record.id)}
          >
            {record.request.name}
          </button>
          <small>
            {record.environmentId === null
              ? tr("No environment")
              : record.environmentName || tr("No environment")}
          </small>
          <button
            aria-label={tr("Cancel AI request %{name}", {
              name: record.request.name,
            })}
            onClick={() => onCancel(record.id)}
          >
            {tr("Cancel")}
          </button>
        </div>
      ))}
    </section>
  );
}
