import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ScriptReport } from "../../types";
export function ScriptResults({ report }: { report: ScriptReport }) {
  const { t } = useTranslation();
  const details = useRef<HTMLDetailsElement>(null);
  const failed =
    !!report.error ||
    !!report.runs?.some((run) => !run.passed) ||
    !!report.tests?.some((test) => !test.passed);
  useEffect(() => {
    if (details.current) details.current.open = failed;
  }, [report, failed]);
  return (
    <details
      ref={details}
      className="script-results"
      data-failed={failed}
      aria-label={t("Script results")}
      open={failed}
    >
      <summary>
        <strong>
          {failed ? "✕" : "✓"} {t("Script results")}
        </strong>
        {!!report.variableUpdates?.length && (
          <span className="script-result-meta">
            {t("Variables updated")}:{" "}
            {report.variableUpdates.map((update) => update.key).join(", ")}
          </span>
        )}
      </summary>
      {report.error && (
        <div className="error" role="alert">
          {t("Script failed")}: {report.error.message}
        </div>
      )}
      {report.runs?.map((run, i) => (
        <div key={i} className={run.passed ? "" : "error"}>
          <span>
            {run.passed ? "✓" : "✕"} {run.scope}
          </span>
          <span className="script-result-meta">
            {t(run.phase === "preRequest" ? "Pre-request" : "Post-response")}
          </span>
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
