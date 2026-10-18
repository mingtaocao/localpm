import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "./editor/CodeEditor";
import type { EditorSessions } from "./editor/editorSessions";

export function scriptText(metadata: any, phase: string): string {
  return (metadata?.event ?? [])
    .filter((event: any) => event.listen === phase)
    .map((event: any) =>
      Array.isArray(event.script?.exec)
        ? event.script.exec.join("\n")
        : (event.script?.exec ?? ""),
    )
    .join("\n");
}
export function scriptMetadata(
  metadata: any,
  fallback: any,
  phase: string,
  value: string,
) {
  const events = metadata?.event ?? fallback?.event ?? [];
  const existing = events.find((event: any) => event.listen === phase);
  return {
    ...metadata,
    localpmScriptsEnabled: true,
    event: [
      ...events.filter((event: any) => event.listen !== phase),
      {
        ...existing,
        listen: phase,
        script: {
          ...existing?.script,
          type: "text/javascript",
          exec: value.split("\n"),
        },
      },
    ],
  };
}
export function ScriptsEditor({
  metadata,
  fallback,
  onChange,
  sessions,
  stateKey,
  theme,
  inherited = false,
  enableToggle = true,
}: {
  metadata: any;
  fallback?: any;
  onChange: (metadata: any) => void;
  sessions: EditorSessions;
  stateKey: string;
  theme: "light" | "dark";
  inherited?: boolean;
  enableToggle?: boolean;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState("test");
  const source = metadata?.event !== undefined ? metadata : fallback;
  const value = scriptText(source, phase);
  const change = (value: string) =>
    onChange(scriptMetadata(metadata, fallback, phase, value));
  return (
    <div className="scripts-editor">
      <div
        className="script-tabs"
        role="tablist"
        aria-label={t("Script phase")}
      >
        <button
          role="tab"
          aria-selected={phase === "prerequest"}
          onClick={() => setPhase("prerequest")}
        >
          {t("Pre-request")}
        </button>
        <button
          role="tab"
          aria-selected={phase === "test"}
          onClick={() => setPhase("test")}
        >
          {t("Post-response")}
        </button>
      </div>
      <div className="script-options">
        {enableToggle && (
          <label>
            <input
              type="checkbox"
              checked={metadata?.localpmScriptsEnabled === true}
              onChange={(e) =>
                onChange({
                  ...metadata,
                  localpmScriptsEnabled: e.target.checked,
                })
              }
            />
            {t("Run scripts for this request")}
          </label>
        )}
        <button
          onClick={() =>
            change(
              value +
                (value ? "\n\n" : "") +
                (phase === "test"
                  ? 'const data = pm.response.json();\nif (pm.response.code !== 200 || !data.token) {\n  throw new Error("Response has no token");\n}\npm.globals.set("token", data.token);'
                  : 'pm.variables.set("timestamp", String(Date.now()));'),
            )
          }
        >
          {t(phase === "test" ? "Insert token extraction" : "Insert timestamp")}
        </button>
      </div>
      <CodeEditor
        stateKey={`${stateKey}:scripts:${phase}`}
        sessions={sessions}
        value={value}
        language="javascript"
        theme={theme}
        label={t(
          phase === "test" ? "Post-response script" : "Pre-request script",
        )}
        onChange={change}
      />
      <details className="script-help">
        <summary>{t("Script help")}</summary>
        <p className="muted">
          {t(
            enableToggle
              ? "Scripts use pm APIs. Imported scripts run only after you enable them. Editing enables scripts."
              : "Inherited scripts run when scripts are enabled on the request.",
          )}
          {inherited &&
            ` ${t("Collection and folder scripts run before request scripts.")}`}
        </p>
        <p className="muted">
          {t(
            "Supported: response, variables, console, synchronous tests. No external packages or asynchronous requests.",
          )}
        </p>
      </details>
    </div>
  );
}
