import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExecutionRecord } from "../types";
import { Icon } from "./Icon";

function prettyBody(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function McpExecutionPanel({
  record,
  onClose,
}: {
  record: ExecutionRecord;
  onClose: () => void;
}) {
  const { t: tr } = useTranslation();
  const [view, setView] = useState<"body" | "headers">("body");
  const [format, setFormat] = useState<"Pretty" | "Raw">("Pretty");
  const response = record.response;
  const statusLabel = {
    running: "Sending request…",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  }[record.status];
  const requestSnapshot = {
    params: record.request.params
      .filter((pair) => pair.enabled)
      .map(({ key, value }) => ({ key, value })),
    headers: record.request.headers
      .filter((pair) => pair.enabled)
      .map(({ key, value }) => ({ key, value })),
    body: record.request.body,
  };

  return (
    <section
      className="panel execution-panel"
      aria-label={tr("Execution result")}
    >
      <div className="panel-heading">
        <h2>{record.request.name}</h2>
        <button
          className="icon-button"
          aria-label={tr("Close execution result")}
          title={tr("Close execution result")}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="execution-context">
        <span className="execution-source">
          {tr(record.source === "mcp" ? "AI" : "Manual")}
        </span>
        <span>
          {record.environmentId === null
            ? tr("No environment")
            : record.environmentName || tr("No environment")}
        </span>
        <time dateTime={new Date(record.startedAt).toISOString()}>
          {new Date(record.startedAt).toLocaleString()}
        </time>
        <span>{tr("Execution snapshot")}</span>
      </div>
      <div className="execution-request">
        <span className="method">{record.request.method}</span>
        <code>{record.request.url}</code>
      </div>
      <details className="execution-request-details">
        <summary>{tr("Request details")}</summary>
        <pre>{JSON.stringify(requestSnapshot, null, 2)}</pre>
      </details>
      <div className="response-heading execution-response-heading">
        <div className="metrics">
          {response ? (
            <>
              <b
                className={
                  response.status >= 400
                    ? "status-error"
                    : response.status >= 300
                      ? "status-redirect"
                      : "status-success"
                }
              >
                {response.status} {response.statusText}
              </b>
              <span>
                {response.duration} {tr("ms")}
              </span>
              <span>
                {(response.size / 1024).toFixed(2)} {tr("KB")}
              </span>
            </>
          ) : (
            <span>{tr(statusLabel)}</span>
          )}
        </div>
        {response && (
          <div className="response-tools">
            <button
              className={view === "body" ? "active" : ""}
              aria-label={tr("Response body")}
              aria-pressed={view === "body"}
              onClick={() => setView("body")}
            >
              {tr("Response body label")}
            </button>
            <button
              className={view === "headers" ? "active" : ""}
              aria-label={tr("Response headers")}
              aria-pressed={view === "headers"}
              onClick={() => setView("headers")}
            >
              {tr("Response headers")}
            </button>
            {view === "body" && (
              <select
                aria-label={tr("Response format")}
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as "Pretty" | "Raw")
                }
              >
                <option value="Pretty">{tr("Pretty")}</option>
                <option value="Raw">{tr("Raw")}</option>
              </select>
            )}
          </div>
        )}
      </div>
      {record.error && (
        <div className="error" role="alert">
          {record.error.message}
          <small className="execution-error-code">{record.error.code}</small>
        </div>
      )}
      {response && (
        <div className="execution-response">
          {view === "headers" ? (
            <div>
              {response.headers.map(([name, value], index) => (
                <div className="response-header" key={index}>
                  <b>{name}</b>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          ) : response.binary ? (
            <p className="muted">{tr("Binary response.")}</p>
          ) : (
            <>
              {response.truncated && (
                <p className="muted">
                  {tr(
                    "Only the response preview is available in this execution snapshot.",
                  )}
                </p>
              )}
              <pre className="execution-body">
                {format === "Pretty"
                  ? prettyBody(response.body)
                  : response.body}
              </pre>
            </>
          )}
        </div>
      )}
      {record.status === "running" && (
        <p className="muted">{tr("Waiting for this request's response.")}</p>
      )}
    </section>
  );
}
