import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import type {
  ExecutionRecord,
  HistoryEntry,
  McpConfig,
  McpStatus,
  RequestSpec,
  Workspace,
} from "../src/types";

type Connection = {
  mcpServers: Record<string, { url: string; headers: Record<string, string> }>;
};
type RpcClient = {
  call: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
};
type Backend = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  connect: () => Promise<RpcClient>;
};

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function connectMcp(connection: Connection): Promise<RpcClient> {
  const server = Object.values(connection.mcpServers)[0];
  if (!server?.url) throw new Error("Missing MCP connection endpoint");
  let session: string | null = null;
  let protocol = "2025-03-26";
  let nextId = 0;
  const rpc = async (method: string, params: unknown, notification = false) => {
    const id = notification ? undefined : ++nextId;
    const response = await fetch(server.url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        ...server.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(session ? { "Mcp-Session-Id": session } : {}),
        ...(method !== "initialize"
          ? { "MCP-Protocol-Version": protocol }
          : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok)
      throw new Error(`MCP ${method} returned HTTP ${response.status}`);
    session = response.headers.get("mcp-session-id") ?? session;
    if (notification) return null;
    const text = await response.text();
    const message = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? JSON.parse(text)
      : text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5).trim()))
          .find((entry) => entry.id === id);
    if (!message) throw new Error(`MCP ${method} did not return a result`);
    if (message.error)
      throw new Error(`MCP ${method}: ${message.error.message}`);
    return message.result;
  };
  const initialized = await rpc("initialize", {
    protocolVersion: protocol,
    capabilities: {},
    clientInfo: { name: "local-postman-ui-tests", version: "1.0.0" },
  });
  protocol = initialized.protocolVersion;
  await rpc("notifications/initialized", {}, true);
  return {
    call: async <T>(name: string, args: Record<string, unknown>) => {
      const result = await rpc("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(`MCP tool ${name} failed`);
      if (result.structuredContent) return result.structuredContent as T;
      const content = result.content.find(
        (entry: { type: string }) => entry.type === "text",
      );
      if (!content) throw new Error(`MCP tool ${name} did not return JSON`);
      return JSON.parse(content.text) as T;
    },
  };
}

const test = base.extend<{ backend: Backend }>({
  backend: async ({ page }, use) => {
    const data = mkdtempSync(join(tmpdir(), "lp-mcp-ui-"));
    const child: ChildProcessWithoutNullStreams = spawn(
      resolve(
        "src-tauri/target/debug/examples/mcp_test_server" +
          (process.platform === "win32" ? ".exe" : ""),
      ),
      [],
      { env: { ...process.env, LOCAL_POSTMAN_DATA_DIR: data } },
    );
    let nextId = 0;
    let closing = false;
    const pending = new Map<
      number,
      { resolve: (value: any) => void; reject: (error: unknown) => void }
    >();
    const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
      new Promise<T>((resolve, reject) => {
        if (closing) {
          resolve(null as T);
          return;
        }
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
      });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const output = JSON.parse(line);
      if (output.event) {
        void page
          .evaluate(({ event, payload }) => {
            (window as any).__dispatchTauriEvent?.(event, payload);
          }, output)
          .catch(() => {});
        return;
      }
      const request = pending.get(output.id);
      pending.delete(output.id);
      if (output.error) request?.reject(output.error);
      else request?.resolve(output.value);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", (error) => {
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    });
    child.on("exit", (code) => {
      for (const request of pending.values())
        request.reject(new Error(`MCP test bridge exited with ${code}`));
      pending.clear();
    });
    await page.exposeBinding("__mcpRustInvoke", (_, cmd, args) =>
      invoke(cmd, args),
    );
    await page.addInitScript(() => {
      let nextId = 0;
      const callbacks = new Map<number, (value: unknown) => void>();
      const listeners = new Map<number, { event: string; handler: number }>();
      (window as any).__dispatchTauriEvent = (
        event: string,
        payload: unknown,
      ) => {
        for (const [id, listener] of listeners)
          if (listener.event === event)
            callbacks.get(listener.handler)?.({ event, id, payload });
      };
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_: string, id: number) => listeners.delete(id),
      };
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: (callback: (value: unknown) => void) => {
          const id = ++nextId;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (cmd: string, args: any) => {
          if (cmd === "plugin:event|listen") {
            const id = ++nextId;
            listeners.set(id, { event: args.event, handler: args.handler });
            return id;
          }
          if (cmd === "plugin:event|unlisten") {
            listeners.delete(args.eventId);
            return null;
          }
          if (cmd.startsWith("plugin:dialog|")) return null;
          return (window as any).__mcpRustInvoke(cmd, args);
        },
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as any).__copiedConnection = text;
          },
        },
      });
    });
    const saved: RequestSpec = {
      id: "saved-echo",
      name: "Saved echo",
      method: "POST",
      url: "{{host}}/delay?ms=1200",
      params: [{ key: "ms", value: "1200", enabled: true, description: "" }],
      headers: [
        { key: "X-Stage", value: "{{stage}}", enabled: true, description: "" },
      ],
      auth: { type: "inherit" },
      body: {
        mode: "raw",
        raw: '{"message":"saved-body"}',
        options: { raw: { language: "json" } },
      },
      settings: {},
      metadata: null,
    };
    const slow: RequestSpec = {
      ...structuredClone(saved),
      id: "saved-slow",
      name: "Slow saved request",
      method: "GET",
      url: "{{host}}/delay?ms=30000",
      params: [{ key: "ms", value: "30000", enabled: true, description: "" }],
      body: { mode: "none" },
    };
    const workspace: Workspace = {
      collections: [
        {
          id: "automation-api",
          name: "Automation API",
          auth: { type: "noauth" },
          variables: [],
          metadata: null,
        },
      ],
      items: [saved, slow].map((request, order) => ({
        id: `item-${request.id}`,
        name: request.name,
        collectionId: "automation-api",
        parentId: null,
        kind: "request",
        order,
        auth: { type: "inherit" },
        request,
        metadata: null,
      })),
      environments: ["DEV", "STAGING"].map((name) => ({
        id: name,
        name,
        variables: [
          {
            key: "host",
            value: "http://127.0.0.1:47831",
            enabled: true,
            description: "",
          },
          {
            key: "stage",
            value: name === "DEV" ? "dev-stage" : "staging-stage",
            enabled: true,
            description: "",
          },
        ],
        settings: {},
        metadata: null,
      })),
      activeEnvironment: "DEV",
      globals: [],
      settings: {
        language: "en-US",
        theme: "light",
        proxy: { mode: "off" },
        historyLimit: 1000,
      },
    };
    const config: McpConfig = {
      enabled: false,
      port: await unusedPort(),
      readCollections: [],
      executeCollections: [],
      environments: [],
      allowNoEnvironment: false,
    };
    try {
      await invoke("save_workspace", { workspace });
      await invoke("mcp_configure", { config });
      await use({
        invoke,
        connect: async () =>
          connectMcp(await invoke<Connection>("mcp_connection_config")),
      });
    } finally {
      closing = true;
      if (child.exitCode === null) {
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
        const timeout = setTimeout(() => child.kill(), 5000);
        child.stdin.end();
        await exited;
        clearTimeout(timeout);
      }
    }
  },
});

async function openMcpSettings(page: Page) {
  await page.getByRole("button", { name: "⚙ Settings", exact: true }).click();
  await page.getByText("AI access (MCP)", { exact: true }).click();
}

async function enableMcp(page: Page) {
  await openMcpSettings(page);
  await page
    .getByLabel("Read requests from Automation API", { exact: true })
    .check();
  await page
    .getByLabel("Send requests from Automation API", { exact: true })
    .check();
  await page.getByLabel("Allow environment STAGING", { exact: true }).check();
  await page.getByRole("button", { name: "Enable MCP", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop MCP", exact: true }),
  ).toBeVisible();
}

test("MCP permissions, local connection copying and stop controls work in a small window", async ({
  page,
  backend,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/");
  await enableMcp(page);
  const status = await backend.invoke<McpStatus>("mcp_status");
  expect(status.running).toBe(true);
  expect(status.config.readCollections).toEqual(["automation-api"]);
  expect(status.config.executeCollections).toEqual(["automation-api"]);
  expect(status.config.environments).toEqual(["STAGING"]);
  await page.screenshot({ path: "artifacts/mcp-settings-minimum.png" });
  await page
    .getByRole("button", { name: "Copy connection configuration", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copiedConnection ?? ""))
    .not.toBe("");
  const copied = JSON.parse(
    await page.evaluate(() => (window as any).__copiedConnection),
  ) as Connection;
  const connection = Object.values(copied.mcpServers)[0];
  expect(new URL(connection.url).hostname).toBe("127.0.0.1");
  expect(connection.headers.Authorization.startsWith("Bearer ")).toBe(true);
  const token = connection.headers.Authorization.slice("Bearer ".length);
  expect(await page.locator("body").innerText()).not.toContain(token);

  await page
    .getByLabel("Read requests from Automation API", { exact: true })
    .uncheck();
  await expect(
    page.getByLabel("Send requests from Automation API", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Save permissions", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await backend.invoke<McpStatus>("mcp_status")).config
          .executeCollections,
    )
    .toEqual([]);
  const stop = page.getByRole("button", { name: "Stop MCP", exact: true });
  await stop.click();
  await expect(
    page.getByRole("button", { name: "Enable MCP", exact: true }),
  ).toBeVisible();
  expect((await backend.invoke<McpStatus>("mcp_status")).running).toBe(false);
});

test("AI executes a saved preview in the specified environment and preserves the foreground draft and response", async ({
  page,
  backend,
}) => {
  await page.goto("/");
  await enableMcp(page);
  await page.getByRole("button", { name: "Close ×", exact: true }).click();
  if (
    await page
      .getByRole("button", { name: "Show requests", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Show requests", exact: true })
      .click();
  await page
    .locator("aside")
    .getByRole("button", { name: "POST Saved echo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide requests", exact: true })
    .click();
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  const response = page.locator(".response .cm-content");
  await expect(response).toContainText("dev-stage");
  const foregroundResponse = await response.innerText();
  const client = await backend.connect();
  const preview = await client.call<{ previewId: string }>("preview_request", {
    requestId: "saved-echo",
    environmentId: "STAGING",
  });

  await page
    .getByLabel("Request name", { exact: true })
    .fill("My foreground draft");
  await page
    .getByLabel("Request URL", { exact: true })
    .fill("https://not-sent.example.test/local-edit");
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await page
    .locator(".request-editor .cm-content")
    .fill('{"message":"local-draft-body"}');
  const run = await client.call<{ executionId: string }>("run_request", {
    previewId: preview.previewId,
  });
  await expect(page.getByLabel("AI executions", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Request name", { exact: true })).toHaveValue(
    "My foreground draft",
  );
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("DEV");
  await expect(response).toHaveText(foregroundResponse, { useInnerText: true });
  await expect
    .poll(
      async () =>
        (
          await client.call<ExecutionRecord>("get_execution", {
            executionId: run.executionId,
          })
        ).status,
    )
    .toBe("completed");
  const execution = await client.call<ExecutionRecord>("get_execution", {
    executionId: run.executionId,
  });
  expect(execution.request.name).toBe("Saved echo");
  expect(execution.response?.body).toContain("saved-body");
  expect(execution.response?.body).toContain("staging-stage");
  expect(execution.response?.body).not.toContain("local-draft-body");
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("DEV");
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    "https://not-sent.example.test/local-edit",
  );
  await expect(response).toHaveText(foregroundResponse, { useInnerText: true });

  if (
    await page
      .getByRole("button", { name: "Show requests", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Show requests", exact: true })
      .click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page
    .locator(".history-record")
    .filter({ hasText: "STAGING" });
  await history
    .getByRole("button", { name: "View result for Saved echo", exact: true })
    .click();
  const result = page.getByLabel("Execution result", { exact: true });
  await expect(result).toContainText("STAGING");
  await expect(result).toContainText("staging-stage");
  await expect(result).toContainText("saved-body");
  await page.setViewportSize({ width: 900, height: 640 });
  await page.screenshot({ path: "artifacts/mcp-execution-minimum.png" });
  const historyBeforeShortcut =
    await backend.invoke<HistoryEntry[]>("get_history");
  await page.keyboard.press("Control+Enter");
  await expect(result).toBeVisible();
  await page.keyboard.press("Control+w");
  await expect(result).toBeHidden();
  await expect(page.getByLabel("Request name", { exact: true })).toHaveValue(
    "My foreground draft",
  );
  await expect(page.locator(".request-editor .cm-content")).toContainText(
    "local-draft-body",
  );
  await expect(response).toHaveText(foregroundResponse, { useInnerText: true });
  expect((await backend.invoke<HistoryEntry[]>("get_history")).length).toBe(
    historyBeforeShortcut.length,
  );
});

test("a slow AI request can be cancelled from the UI without taking over the editor", async ({
  page,
  backend,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/");
  await enableMcp(page);
  await page.getByRole("button", { name: "Close ×", exact: true }).click();
  await page
    .getByLabel("Request URL", { exact: true })
    .fill("https://foreground.example.test/unsent");
  const client = await backend.connect();
  const preview = await client.call<{ previewId: string }>("preview_request", {
    requestId: "saved-slow",
    environmentId: "STAGING",
  });
  const run = await client.call<{ executionId: string }>("run_request", {
    previewId: preview.previewId,
  });
  const cancel = page.getByRole("button", {
    name: "Cancel AI request Slow saved request",
    exact: true,
  });
  await expect(cancel).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Send ↗", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: "artifacts/mcp-running-minimum.png" });
  await cancel.click();
  await expect
    .poll(
      async () =>
        (
          await client.call<ExecutionRecord>("get_execution", {
            executionId: run.executionId,
          })
        ).status,
    )
    .toBe("cancelled");
  await expect(page.getByLabel("AI executions", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    "https://foreground.example.test/unsent",
  );
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("DEV");
  await expect(page.locator(".response .cm-content")).toHaveCount(0);
  if (
    await page
      .getByRole("button", { name: "Show requests", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Show requests", exact: true })
      .click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", {
      name: "View result for Slow saved request",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Execution result", { exact: true }),
  ).toContainText(/cancel/i);
});
