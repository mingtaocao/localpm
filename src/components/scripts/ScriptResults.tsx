import { useTranslation } from "react-i18next";
import type { ScriptReport } from "../../types";
export function ScriptResults({ report }: { report: ScriptReport }) {
  const { t } = useTranslation();
  return (
    <details
      className="script-results"
      aria-label={t("Script results")}
      open={!!report.error}
    >
      <summary>
        <strong>
          {report.error || report.tests?.some((test) => !test.passed)
            ? "✕"
            : "✓"}{" "}
          {t("Script results")}
        </strong>
        {!!report.variableUpdates?.length && (
          <>
            {" "}
            · {t("Variables updated")}:{" "}
            {report.variableUpdates.map((update) => update.key).join(", ")}
          </>
        )}
      </summary>
      {report.error && (
        <div className="error" role="alert">
          {t("Script failed")}: {report.error.message}
        </div>
      )}
      {report.runs?.map((run, i) => (
        <div key={i} className={run.passed ? "" : "error"}>
          {run.passed ? "✓" : "✕"} {run.scope} ·{" "}
          {t(run.phase === "preRequest" ? "Pre-request" : "Post-response")}
          {run.error && `: ${run.error}`}
        </div>
      ))}
      {!!report.variableUpdates?.length && (
        <p>
          {t("Variables updated")}:{" "}
          {report.variableUpdates.map((v) => `${v.scope}.${v.key}`).join(", ")}
        </p>
      )}
      {report.tests?.map((test, i) => (
        <div key={i} className={test.passed ? "" : "error"}>
          {test.passed ? "✓" : "✕"} {test.name}
          {test.error && `: ${test.error}`}
        </div>
      ))}
      {!!report.logs?.length && (
        <details>
          <summary>
            {t("Script logs")} ({report.logs.length})
          </summary>
          <pre>
            {report.logs
              .map((log) => `[${log.level}] ${log.message}`)
              .join("\n")}
          </pre>
        </details>
      )}
    </details>
  );
}
