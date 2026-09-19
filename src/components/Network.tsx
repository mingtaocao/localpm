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
  const [passwordDraft, setPasswordDraft] = useState<string | undefined>();
  const p = value.proxy ?? { mode: global ? "off" : "inherit" };
  const set = (key: string, v: any) => onChange({ ...value, [key]: v });
  const proxy = (key: string, v: any) => set("proxy", { ...p, [key]: v });
  return (
    <div className="form">
      <label>
        Timeout (ms)
        <input
          type="number"
          placeholder="Inherit · 30000"
          value={value.timeout ?? ""}
          onChange={(e) =>
            set("timeout", e.target.value ? Number(e.target.value) : null)
          }
        />
      </label>
      <label>
        Certificate verification
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
          <option value="inherit">Inherit</option>
          <option value="true">Verify certificates</option>
          <option value="false">Disable verification</option>
        </select>
      </label>
      {value.verifyTls === false && (
        <div className="warning">
          ⚠ TLS verification disabled. Server identity will not be verified.
        </div>
      )}
      <label>
        Redirects
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
          <option value="inherit">Inherit</option>
          <option value="true">Follow · max 10</option>
          <option value="false">Do not follow</option>
        </select>
      </label>
      <label>
        Proxy
        <select
          aria-label="Proxy"
          value={p.mode}
          onChange={(e) => proxy("mode", e.target.value)}
        >
          {!global && <option value="inherit">Inherit</option>}
          <option value="off">Off · direct connection</option>
          <option value="system">System</option>
          <option value="manual">Manual HTTP / HTTPS</option>
        </select>
      </label>
      {p.mode === "manual" && (
        <>
          <label>
            Proxy URL
            <input
              placeholder="http://127.0.0.1:7890"
              value={p.url ?? ""}
              onChange={(e) => proxy("url", e.target.value)}
            />
          </label>
          <label>
            Username
            <input
              value={p.username ?? ""}
              onChange={(e) => proxy("username", e.target.value)}
            />
          </label>
          <label>
            Password · OS credential store
            <input
              type="password"
              placeholder={p.secretRef ? "Saved securely" : ""}
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
            No Proxy
            <textarea
              placeholder="localhost, 127.0.0.1, *.company.com"
              value={p.noProxy ?? ""}
              onChange={(e) => proxy("noProxy", e.target.value)}
            />
          </label>
        </>
      )}
      <label>
        Custom CA PEM
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
          Choose CA file
        </button>
      </label>
      {global && (
        <label>
          History retention
          <select
            value={value.historyLimit ?? 1000}
            onChange={(e) => set("historyLimit", Number(e.target.value))}
          >
            {[100, 500, 1000, 5000, 0].map((n) => (
              <option value={n} key={n}>
                {n || "Unlimited"}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
