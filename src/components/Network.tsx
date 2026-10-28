import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";
import { api } from "../services/tauriApi";
import { inheritedSetting, type SettingsLayer } from "../utils/uiContext";
export function Network({
  value,
  onChange,
  global = false,
  inherited = [],
}: {
  value: any;
  onChange: (v: any) => void;
  global?: boolean;
  inherited?: SettingsLayer[];
}) {
  const { t: tr } = useTranslation();
  const [passwordDraft, setPasswordDraft] = useState<string | undefined>();
  const p = value.proxy ?? { mode: global ? "off" : "inherit" };
  const set = (key: string, v: any) => onChange({ ...value, [key]: v });
  const proxy = (key: string, v: any) => set("proxy", { ...p, [key]: v });
  const effective = (key: string) => inheritedSetting(inherited, key);
  const origin = (key: string) => {
    const setting = effective(key);
    return !global &&
      (value[key] == null || (key === "proxy" && p.mode === "inherit")) ? (
      <small className="field-origin">
        {setting.source
          ? tr("From %{source}", { source: setting.source })
          : tr("Application default")}
      </small>
    ) : null;
  };
  const control = (key: string, children: ReactNode) => (
    <span className="network-control">
      {children}
      {origin(key)}
    </span>
  );
  const proxyNames: Record<string, string> = {
    off: "Direct connection",
    system: "System",
    manual: "Manual HTTP / HTTPS",
  };
  return (
    <div className="form network-form">
      <label>
        {tr("Timeout (ms)")}
        {control(
          "timeout",
          <input
            aria-label={tr("Timeout (ms)")}
            type="number"
            min="1"
            step="1"
            placeholder={String(effective("timeout").value)}
            value={value.timeout ?? ""}
            onChange={(e) =>
              set("timeout", e.target.value ? Number(e.target.value) : null)
            }
          />,
        )}
      </label>
      <label>
        {tr("Certificate verification")}
        {control(
          "verifyTls",
          <select
            aria-label={tr("Certificate verification")}
            value={
              value.verifyTls == null
                ? global
                  ? "true"
                  : "inherit"
                : String(value.verifyTls)
            }
            onChange={(e) =>
              set(
                "verifyTls",
                e.target.value === "inherit" ? null : e.target.value === "true",
              )
            }
          >
            {!global && (
              <option value="inherit">
                {tr("Inherit: %{value}", {
                  value: tr(
                    effective("verifyTls").value === false
                      ? "Disable verification"
                      : "Verify certificates",
                  ),
                })}
              </option>
            )}
            <option value="true">{tr("Verify certificates")}</option>
            <option value="false">{tr("Disable verification")}</option>
          </select>,
        )}
      </label>
      {value.verifyTls === false && (
        <div className="warning">
          {tr(
            "⚠ TLS verification disabled. Server identity will not be verified.",
          )}
        </div>
      )}
      <label>
        {tr("Redirects")}
        {control(
          "followRedirect",
          <select
            aria-label={tr("Redirects")}
            value={
              value.followRedirect == null
                ? global
                  ? "true"
                  : "inherit"
                : String(value.followRedirect)
            }
            onChange={(e) =>
              set(
                "followRedirect",
                e.target.value === "inherit" ? null : e.target.value === "true",
              )
            }
          >
            {!global && (
              <option value="inherit">
                {tr("Inherit: %{value}", {
                  value: tr(
                    effective("followRedirect").value === false
                      ? "Do not follow"
                      : "Follow redirects (up to 10)",
                  ),
                })}
              </option>
            )}
            <option value="true">{tr("Follow redirects (up to 10)")}</option>
            <option value="false">{tr("Do not follow")}</option>
          </select>,
        )}
      </label>
      <label>
        {tr("Proxy")}
        {control(
          "proxy",
          <select
            aria-label={tr("Proxy")}
            value={p.mode}
            onChange={(e) => proxy("mode", e.target.value)}
          >
            {!global && (
              <option value="inherit">
                {tr("Inherit: %{value}", {
                  value: tr(
                    proxyNames[effective("proxy").value.mode] ??
                      "Direct connection",
                  ),
                })}
              </option>
            )}
            {Object.entries(proxyNames).map(([mode, name]) => (
              <option key={mode} value={mode}>
                {tr(name)}
              </option>
            ))}
          </select>,
        )}
      </label>
      {p.mode === "manual" && (
        <>
          <label>
            {tr("Proxy URL")}
            <input
              placeholder="http://127.0.0.1:7890"
              value={p.url ?? ""}
              onChange={(e) => proxy("url", e.target.value)}
            />
          </label>
          <label>
            {tr("Username")}
            <input
              value={p.username ?? ""}
              onChange={(e) => proxy("username", e.target.value)}
            />
          </label>
          <label>
            {tr("Password")}
            <input
              type="password"
              placeholder={p.secretRef ? tr("Saved securely") : ""}
              value={passwordDraft ?? p.password ?? ""}
              onChange={(e) => setPasswordDraft(e.target.value)}
              onBlur={() => {
                if (passwordDraft !== undefined) {
                  proxy("password", passwordDraft);
                  setPasswordDraft(undefined);
                }
              }}
            />
          </label>
          <label>
            {tr("No Proxy")}
            <textarea
              placeholder="localhost, 127.0.0.1, *.company.com"
              value={p.noProxy ?? ""}
              onChange={(e) => proxy("noProxy", e.target.value)}
            />
          </label>
        </>
      )}
      <label>
        {tr("Custom CA PEM")}
        <span className="network-control">
          <span className="file-control">
            <input
              aria-label={tr("Custom CA PEM")}
              placeholder={global ? "" : effective("caFile").value}
              value={value.caFile ?? ""}
              onChange={(e) => set("caFile", e.target.value)}
            />
            <button
              onClick={async () => {
                const path = await api.file();
                if (path) set("caFile", path);
              }}
            >
              {tr("Choose CA file")}
            </button>
          </span>
          {origin("caFile")}
        </span>
      </label>
    </div>
  );
}
