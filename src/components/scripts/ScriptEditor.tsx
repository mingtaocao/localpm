import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "../editor/CodeEditor";
import { HelpTip } from "../HelpTip";
import type { EditorSessions } from "../editor/editorSessions";
import type { ScriptSet } from "../../scripts/model";
export function ScriptEditor({
  requestId,
  value,
  onChange,
  theme,
  sessions,
  inherited = [],
  inheritedEnabled = false,
  onInheritedChange,
}: {
  requestId: string;
  value: ScriptSet;
  onChange: (value: ScriptSet) => void;
  theme: "light" | "dark";
  sessions: EditorSessions;
  inherited?: string[];
  inheritedEnabled?: boolean;
  onInheritedChange?: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"preRequest" | "postResponse">(
    "postResponse",
  );
  return (
    <div className="script-editor">
      <div className="script-toolbar">
        <div role="group" aria-label={t("Script stage")}>
          {(["preRequest", "postResponse"] as const).map((key) => (
            <button
              key={key}
              className={phase === key ? "active" : ""}
              aria-pressed={phase === key}
              onClick={() => setPhase(key)}
            >
              {t(key === "preRequest" ? "Pre-request" : "Post-response")}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />
          {t("Run this request's scripts")}
        </label>
        <button
          onClick={() =>
            onChange({
              ...value,
              enabled: true,
              [phase]:
                value[phase] +
                (value[phase] ? "\n\n" : "") +
                (phase === "postResponse"
                  ? 'const data = pm.response.json();\npm.environment.set("token", data.data.token);'
                  : 'pm.variables.set("timestamp", Date.now());'),
            })
          }
        >
          {t("Insert snippet")}
        </button>
        <HelpTip label={t("Script help")}>
          <p>
            {t(
              "Extract a response field, then use {{token}} in the next request. Select an environment before writing environment variables.",
            )}
          </p>
          <p>
            {t(
              "Scripts support pm.response, variable get/set/unset, pm.test and basic pm.expect. pm.sendRequest and async scripts are not supported.",
            )}
          </p>
        </HelpTip>
      </div>
      {!!inherited.length && onInheritedChange && (
        <label className="script-inheritance">
          <input
            type="checkbox"
            checked={inheritedEnabled}
            onChange={(e) => onInheritedChange(e.target.checked)}
          />
          {t("Enable inherited collection scripts")}
        </label>
      )}
      {!!inherited.length && (
        <p className="muted script-help">
          {t("Inherited scripts")}: {inherited.join(" / ")}
        </p>
      )}
      <CodeEditor
        key={`${requestId}:${phase}`}
        stateKey={`${requestId}:script:${phase}`}
        sessions={sessions}
        label={t(
          phase === "postResponse"
            ? "Post-response script editor"
            : "Pre-request script editor",
        )}
        theme={theme}
        value={value[phase]}
        language="javascript"
        onChange={(code) => onChange({ ...value, [phase]: code })}
      />
    </div>
  );
}
