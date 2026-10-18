import { useTranslation } from "react-i18next";
import type { ScriptReport } from "../types";
export function ScriptResults({ report }: { report?: ScriptReport | null }) {
  const { t } = useTranslation();
  if (!report) return null;
  const phases = [
    ["prerequest", t("Pre-request")],
    ["postresponse", t("Post-response")],
  ] as const;
  return (
    <details
      className="script-results"
      open={phases.some(
        ([key]) =>
          report[key]?.status === "failed" ||
          report[key]?.tests?.some((test) => !test.passed),
      )}
    >
      <summary>
        {t("Script results")} ·{" "}
        {phases
          .map(([key, label]) =>
            report[key] && report[key]?.status !== "skipped"
              ? `${label}: ${t(report[key]!.status === "failed" ? "Failed" : report[key]?.tests?.some((test) => !test.passed) ? "Tests failed" : "Completed")}`
              : null,
          )
          .filter(Boolean)
          .join(" · ") || t("No scripts")}
      </summary>
      {phases.map(([key, label]) => {
        const phase = report[key];
        return phase && phase.status !== "skipped" ? (
          <section key={key}>
            <strong>{label}</strong>
            {phase.error && (
              <pre role="alert" className="error">
                {phase.error}
              </pre>
            )}
            {phase.tests?.map((test, i) => (
              <div key={i}>
                {test.passed ? "✓" : "✕"} {test.name}
                {test.error && `: ${test.error}`}
              </div>
            ))}
            {phase.logs?.map((log, i) => (
              <pre key={i}>
                [{log.level}] {log.message}
              </pre>
            ))}
          </section>
        ) : null;
      })}
    </details>
  );
}

export function scriptErrorReport(error: unknown): ScriptReport | undefined {
  if (!error || typeof error !== "object" || !("details" in error)) return;
  const details = error.details;
  if (details && typeof details === "object" && "scripts" in details)
    return details.scripts as ScriptReport;
}
