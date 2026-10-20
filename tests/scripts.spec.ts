import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import type { Workspace, RequestSpec } from "../src/types";

for (const language of ["en-US", "zh-CN"])
  test(`two real requests reuse a script variable and survive reload (${language})`, async ({
    page,
  }) => {
    const chinese = language === "zh-CN";
    if (chinese) await page.setViewportSize({ width: 900, height: 640 });
    let observed: { authorization?: string; body: string } | undefined;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (data) => (body += data));
      req.on("end", () => {
        if (req.url === "/users")
          observed = { authorization: req.headers.authorization, body };
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({ data: { token: "ui-new-token-123" }, ok: true }),
        );
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server address");
    const base = `http://127.0.0.1:${address.port}`;
    const data = mkdtempSync(join(tmpdir(), "localpm-scripts-"));
    const child = spawn(
      resolve(
        "src-tauri/target/debug/examples/test_bridge" +
          (process.platform === "win32" ? ".exe" : ""),
      ),
      [],
      { env: { ...process.env, LOCAL_POSTMAN_DATA_DIR: data } },
    );
    let counter = 0;
    const pending = new Map<
      number,
      { resolve: (v: any) => void; reject: (e: any) => void }
    >();
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const r = JSON.parse(line);
      const callback = pending.get(r.id);
      pending.delete(r.id);
      if (r.error) callback?.reject(r.error);
      else callback?.resolve(r.value);
    });
    child.stderr.on("data", (data) => process.stderr.write(data));
    const invoke = (cmd: string, args: any = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = ++counter;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
      });
    const requests: RequestSpec[] = [
      {
        id: "login",
        name: "Login",
        method: "GET",
        url: base + "/login",
        params: [],
        headers: [],
        auth: { type: "noauth" },
        body: { mode: "none" },
        settings: {},
        metadata: null,
      },
      {
        id: "users",
        name: "Users",
        method: "POST",
        url: base + "/users",
        params: [],
        headers: [
          {
            key: "Authorization",
            value: "Bearer {{accessToken}}",
            enabled: true,
            description: "",
          },
        ],
        auth: { type: "noauth" },
        body: {
          mode: "raw",
          raw: '{"token":"{{accessToken}}"}',
          options: { raw: { language: "json" } },
        },
        settings: {},
        metadata: null,
      },
    ];
    const ws: Workspace = {
      collections: [
        {
          id: "api",
          name: "API",
          auth: { type: "noauth" },
          variables: [],
          metadata: null,
        },
      ],
      items: requests.map((request, i) => ({
        id: request.id,
        collectionId: "api",
        parentId: null,
        kind: "request",
        name: request.name,
        order: i,
        auth: { type: "inherit" },
        request,
        metadata: null,
      })),
      environments: [
        { id: "dev", name: "DEV", variables: [], settings: {}, metadata: null },
      ],
      globals: [],
      activeEnvironment: "dev",
      settings: { language, theme: chinese ? "dark" : "light" },
    };
    try {
      await invoke("save_workspace", { workspace: ws });
      await page.exposeBinding("__scriptsInvoke", (_, cmd, args) =>
        invoke(cmd, args),
      );
      await page.addInitScript(() => {
        (window as any).__TAURI_INTERNALS__ = {
          invoke: (cmd: string, args: any) =>
            (window as any).__scriptsInvoke(cmd, args),
        };
      });
      await page.goto("/");
      await page
        .getByRole("button", { name: "GET Login", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: chinese ? "脚本" : "Scripts",
          exact: true,
        })
        .click();
      const editor = page.getByRole("textbox", {
        name: chinese ? "响应后脚本编辑器" : "Post-response script editor",
        exact: true,
      });
      await expect(editor).toBeVisible();
      await editor.fill(
        'const data = pm.response.json();\npm.environment.set("accessToken", data.data.token);\npm.test("response ok", () => pm.response.to.have.status(200));',
      );
      await page
        .getByRole("checkbox", {
          name: chinese ? "执行此请求的脚本" : "Run this request's scripts",
        })
        .check();
      await page
        .getByRole("button", {
          name: chinese ? "发送 ↗" : "Send ↗",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel(chinese ? "脚本结果" : "Script results", {
          exact: true,
        }),
      ).toContainText("accessToken");
      await page.screenshot({ path: `artifacts/scripts-${language}.png` });
      await page
        .getByRole("button", { name: "POST Users", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: chinese ? "发送 ↗" : "Send ↗",
          exact: true,
        })
        .click();
      await expect
        .poll(() => observed)
        .toEqual({
          authorization: "Bearer ui-new-token-123",
          body: '{"token":"ui-new-token-123"}',
        });
      await page.reload();
      await page
        .getByRole("button", { name: "GET Login", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: chinese ? "脚本" : "Scripts",
          exact: true,
        })
        .click();
      await expect(editor).toContainText(
        'pm.environment.set("accessToken", data.data.token)',
      );
      await expect(
        page.getByRole("checkbox", {
          name: chinese ? "执行此请求的脚本" : "Run this request's scripts",
        }),
      ).toBeChecked();
      // A post-script error keeps the HTTP response and reports the missing field explicitly.
      await editor.fill(
        'pm.environment.set("accessToken", pm.response.json().missing);',
      );
      await page
        .getByRole("button", {
          name: chinese ? "发送 ↗" : "Send ↗",
          exact: true,
        })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        chinese ? "脚本执行失败" : "Script failed",
      );
      await expect(
        page.getByRole("textbox", {
          name: chinese ? "响应正文编辑器" : "Response body editor",
          exact: true,
        }),
      ).toContainText("ui-new-token-123");
    } finally {
      child.kill();
      lines.close();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
