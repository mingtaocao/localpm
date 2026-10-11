import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../services/tauriApi";
import type { McpConfig, McpStatus, Workspace } from "../types";

type Props = {
  workspace: Workspace;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
};

export function McpSettings({ workspace, onError, onNotice }: Props) {
  const { t: tr } = useTranslation();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let live = true;
    api.mcpStatus().then(
      (next) => {
        if (!live) return;
        if (next?.config) {
          setStatus(next);
          setConfig(structuredClone(next.config));
        } else setUnavailable(true);
        setLoading(false);
      },
      () => {
        if (!live) return;
        setUnavailable(true);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const dirty =
    !!config &&
    !!status &&
    JSON.stringify(config) !== JSON.stringify(status.config);
  const validPort =
    !!config &&
    Number.isInteger(config.port) &&
    config.port >= 1024 &&
    config.port <= 65535;
  const refreshAfterFailure = async () => {
    const next = await api.mcpStatus().catch(() => null);
    if (!next?.config) return;
    setStatus(next);
    setConfig((draft) =>
      draft
        ? { ...draft, enabled: next.config.enabled }
        : structuredClone(next.config),
    );
  };
  const apply = async (enabled: boolean) => {
    if (!config || !status || busy || (enabled && !validPort)) return;
    setBusy(true);
    try {
      const readCollections = config.readCollections.filter((id) =>
        workspace.collections.some((collection) => collection.id === id),
      );
      const next = await api.mcpConfigure({
        ...config,
        enabled,
        port: validPort ? config.port : status.config.port,
        readCollections,
        executeCollections: config.executeCollections.filter((id) =>
          readCollections.includes(id),
        ),
        environments: config.environments.filter((id) =>
          workspace.environments.some((environment) => environment.id === id),
        ),
      });
      if (!next?.config) throw tr("AI access is unavailable.");
      setStatus(next);
      setConfig(structuredClone(next.config));
      setUnavailable(false);
    } catch (error) {
      await refreshAfterFailure();
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const copyConnection = async () => {
    if (busy || !status?.running) return;
    setBusy(true);
    try {
      const connection = await api.mcpConnectionConfig();
      if (!connection) throw tr("AI access is unavailable.");
      await navigator.clipboard.writeText(JSON.stringify(connection, null, 2));
      onNotice(tr("Connection configuration copied"));
    } catch (error) {
      await refreshAfterFailure();
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const updateCollection = (
    id: string,
    kind: "read" | "execute",
    checked: boolean,
  ) => {
    if (!config) return;
    const field = kind === "read" ? "readCollections" : "executeCollections";
    const selected = checked
      ? [...new Set([...config[field], id])]
      : config[field].filter((value) => value !== id);
    setConfig({
      ...config,
      [field]: selected,
      ...(kind === "read" && !checked
        ? {
            executeCollections: config.executeCollections.filter(
              (value) => value !== id,
            ),
          }
        : {}),
    });
  };

  return (
    <details className="mcp-settings">
      <summary>
        <span>{tr("AI access (MCP)")}</span>
        <small>
          {tr(
            loading
              ? "Loading…"
              : status?.running
                ? "Running locally"
                : status?.config.enabled
                  ? "Not running"
                  : "Disabled",
          )}
        </small>
      </summary>
      <div className="mcp-settings-content">
        <p className="muted">
          {tr(
            "Connected AI clients can read authorized requests. Sending uses your local network and shares the request and response with the client.",
          )}
        </p>
        <div className="mcp-connection-actions">
          <button
            disabled={!config || busy || (!status?.running && !validPort)}
            onClick={() => void apply(!status?.running)}
          >
            {tr(
              status?.running
                ? "Stop MCP"
                : status?.config.enabled
                  ? "Retry MCP"
                  : "Enable MCP",
            )}
          </button>
          {!status?.running && status?.config.enabled && (
            <button disabled={busy} onClick={() => void apply(false)}>
              {tr("Stop MCP")}
            </button>
          )}
          {status?.running && (
            <button disabled={busy} onClick={() => void copyConnection()}>
              {tr("Copy connection configuration")}
            </button>
          )}
          {dirty && (
            <button
              disabled={busy || !validPort}
              onClick={() => void apply(status?.config.enabled ?? false)}
            >
              {tr("Save permissions")}
            </button>
          )}
          {status?.endpoint && (
            <code className="mcp-endpoint">{status.endpoint}</code>
          )}
        </div>
        {unavailable && (
          <p className="muted">{tr("AI access is unavailable.")}</p>
        )}
        {status?.error && (
          <p className="error" role="alert">
            {status.error}
          </p>
        )}
        {!!config && (
          <>
            <details className="mcp-connection-options">
              <summary>{tr("Connection options")}</summary>
              <label>
                {tr("Connection port")}
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  step={1}
                  inputMode="numeric"
                  aria-label={tr("Connection port")}
                  aria-invalid={!validPort}
                  aria-describedby="mcp-port-hint"
                  disabled={busy}
                  value={config.port || ""}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      port: Number.isFinite(event.target.valueAsNumber)
                        ? event.target.valueAsNumber
                        : 0,
                    })
                  }
                />
              </label>
              <small id="mcp-port-hint">
                {tr("Use a port between 1024 and 65535.")}
              </small>
            </details>
            <h3 className="mcp-section-heading">
              {tr("Authorized collections")}
              {dirty && (
                <small aria-live="polite">
                  {tr("Changes not yet applied")}
                </small>
              )}
            </h3>
            {workspace.collections.length ? (
              <table className="mcp-permissions">
                <thead>
                  <tr>
                    <th scope="col">{tr("Collection")}</th>
                    <th scope="col">{tr("Read requests")}</th>
                    <th scope="col">{tr("Send requests")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.collections.map((collection) => (
                    <tr key={collection.id}>
                      <th scope="row">{collection.name}</th>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={tr("Read requests from %{name}", {
                            name: collection.name,
                          })}
                          checked={config.readCollections.includes(
                            collection.id,
                          )}
                          disabled={busy}
                          onChange={(event) =>
                            updateCollection(
                              collection.id,
                              "read",
                              event.target.checked,
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={tr("Send requests from %{name}", {
                            name: collection.name,
                          })}
                          checked={config.executeCollections.includes(
                            collection.id,
                          )}
                          disabled={
                            busy ||
                            !config.readCollections.includes(collection.id)
                          }
                          onChange={(event) =>
                            updateCollection(
                              collection.id,
                              "execute",
                              event.target.checked,
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">
                {tr(
                  "Save requests in a collection to make them available to AI.",
                )}
              </p>
            )}
            <h3>{tr("Allowed environments")}</h3>
            <div className="mcp-environments">
              <label>
                <input
                  type="checkbox"
                  aria-label={tr("Allow requests without an environment")}
                  checked={config.allowNoEnvironment}
                  disabled={busy}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      allowNoEnvironment: event.target.checked,
                    })
                  }
                />
                {tr("No environment")}
              </label>
              {workspace.environments.map((environment) => (
                <label key={environment.id}>
                  <input
                    type="checkbox"
                    aria-label={tr("Allow environment %{name}", {
                      name: environment.name,
                    })}
                    checked={config.environments.includes(environment.id)}
                    disabled={busy}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        environments: event.target.checked
                          ? [
                              ...new Set([
                                ...config.environments,
                                environment.id,
                              ]),
                            ]
                          : config.environments.filter(
                              (id) => id !== environment.id,
                            ),
                      })
                    }
                  />
                  {environment.name}
                </label>
              ))}
            </div>
            <p className="muted">
              {tr(
                "AI chooses an allowed environment for each request. Your active environment stays unchanged.",
              )}
            </p>
          </>
        )}
      </div>
    </details>
  );
}
