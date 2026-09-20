import { useTranslation } from "react-i18next";
import { useState } from "react";
import { api } from "../services/tauriApi";
export function Network({
  value,
  onChange,
  global = false,
}: {
  value: any;
  onChange: (v: any) => void;
  global?: boolean;
}) {
  const { t: tr } = useTranslation();
  const [passwordDraft, setPasswordDraft] = useState<string | undefined>();
  const p = value.proxy ?? { mode: global ? "off" : "inherit" };
  const set = (key: string, v: any) => onChange({ ...value, [key]: v });
  const proxy = (key: string, v: any) => set("proxy", { ...p, [key]: v });
  return (
    <div className="form">
      <label>
        {tr("Timeout (ms)")}
        <input
          type="number"
          placeholder={tr("Inherit · 30000")}
          value={value.timeout ?? ""}
          onChange={(e) =>
            set("timeout", e.target.value ? Number(e.target.value) : null)
          }
        />
      </label>
      <label>
        {tr("Certificate verification")}
        <select
          value={
            value.verifyTls === undefined ? "inherit" : String(value.verifyTls)
          }
          onChange={(e) =>
            set(
              "verifyTls",
              e.target.value === "inherit" ? null : e.target.value === "true",
            )
          }
        >
          <option value="inherit">{tr("Inherit")}</option>
          <option value="true">{tr("Verify certificates")}</option>
          <option value="false">{tr("Disable verification")}</option>
        </select>
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
        <select
          value={
            value.followRedirect === undefined
              ? "inherit"
              : String(value.followRedirect)
          }
          onChange={(e) =>
            set(
              "followRedirect",
              e.target.value === "inherit" ? null : e.target.value === "true",
            )
          }
        >
          <option value="inherit">{tr("Inherit")}</option>
          <option value="true">{tr("Follow · max 10")}</option>
          <option value="false">{tr("Do not follow")}</option>
        </select>
      </label>
      <label>
        {tr("Proxy")}
        <select
          aria-label={tr("Proxy")}
          value={p.mode}
          onChange={(e) => proxy("mode", e.target.value)}
        >
          {!global && <option value="inherit">{tr("Inherit")}</option>}
          <option value="off">{tr("Off · direct connection")}</option>
          <option value="system">{tr("System")}</option>
          <option value="manual">{tr("Manual HTTP / HTTPS")}</option>
        </select>
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
            {tr("Password · OS credential store")}
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
        <input
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
      </label>
      {global && (
        <label>
          {tr("History retention")}
          <select
            value={value.historyLimit ?? 1000}
            onChange={(e) => set("historyLimit", Number(e.target.value))}
          >
            {[100, 500, 1000, 5000, 0].map((n) => (
              <option value={n} key={n}>
                {n || tr("Unlimited")}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
