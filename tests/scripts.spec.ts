import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { Workspace, RequestSpec } from "../src/types";

for (const theme of ["light", "dark"])
  test(`${theme}: Postman-style response script persists globals and the next real request uses them`, async ({
    page,
  }) => {
    const data = mkdtempSync(join(tmpdir(), "localpm-scripts-ui-"));
    const child = spawn(
      resolve("src-tauri/target/debug/examples/test_bridge"),
      [],
      { env: { ...process.env, LOCAL_POSTMAN_DATA_DIR: data } },
    );
    let id = 0;
    const pending = new Map<
      number,
      { resolve: (v: any) => void; reject: (e: any) => void }
    >();
    createInterface({ input: child.stdout }).on("line", (line) => {
      const r = JSON.parse(line);
      const p = pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      if (r.error) p.reject(r.error);
      else p.resolve(r.value);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    const call = (cmd: string, args: any = {}) =>
      new Promise<any>((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        child.stdin.write(JSON.stringify({ id: n, cmd, args }) + "\n");
      });
    const request = (id: string, name: string): RequestSpec => ({
      id,
      name,
      method: "GET",
      url: "http://127.0.0.1:47831/echo",
      params: [],
      headers: [],
      auth: { type: "noauth" },
      body: { mode: "none" },
      settings: {},
      metadata: null,
    });
    const login = request("login", "Login");
    login.headers = [
      {
        key: "X-Token",
        value: "ui-chain-token",
        enabled: true,
        description: "",
      },
    ];
    const profile = request("profile", "Profile");
    profile.auth = { type: "bearer", token: "{{token}}" };
    const workspace: Workspace = {
      collections: [
        {
          id: "c",
          name: "Script API",
          auth: { type: "noauth" },
          variables: [],
          metadata: null,
        },
      ],
      items: [login, profile].map((r, i) => ({
        id: `item-${r.id}`,
        collectionId: "c",
        parentId: null,
        kind: "request",
        name: r.name,
        order: i,
        auth: { type: "inherit" },
        request: r,
        metadata: null,
      })),
      globals: [],
      environments: [],
      activeEnvironment: null,
      settings: { language: "en-US", theme, proxy: { mode: "off" } },
    };
    await call("save_workspace", { workspace });
    await page.exposeBinding("__scriptInvoke", (_, cmd, args) =>
      call(cmd, args),
    );
    await page.addInitScript(() => {
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: any) =>
          (window as any).__scriptInvoke(cmd, args),
      };
    });
    try {
      await page.goto("/");
      const show = page.getByRole("button", {
        name: "Show requests",
        exact: true,
      });
      if (await show.count()) await show.click();
      await page
        .getByRole("button", { name: "GET Login", exact: true })
        .click();
      await page
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page.getByRole("button", { name: "Scripts", exact: true }).click();
      const post = page.getByRole("textbox", {
        name: "Post-response script",
        exact: true,
      });
      await post.fill(
        'const data = pm.response.json();\npm.globals.set("token", data.headers["x-token"]);\npm.test("HTTP is OK", () => pm.expect(pm.response.code).to.equal(200));\nconsole.log("token extracted");',
      );
      await expect(
        page.getByLabel("Run scripts for this request", { exact: true }),
      ).toBeChecked();
      await page.getByRole("tab", { name: "Pre-request", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Pre-request script", exact: true })
        .fill('pm.variables.set("timestamp", String(Date.now()));');
      await page
        .getByRole("tab", { name: "Post-response", exact: true })
        .click();
      await expect(post).toContainText("pm.globals.set");
      await page.getByRole("button", { name: "Send ↗", exact: true }).click();
      await expect(page.locator(".script-results").first()).toContainText(
        "Post-response: Completed",
      );
      await expect
        .poll(
          async () =>
            (await call("app_bootstrap")).workspace.globals.find(
              (p: any) => p.key === "token",
            )?.value,
        )
        .toBe("ui-chain-token");
      await page.locator(".script-results").first().locator("summary").click();
      await expect(page.locator(".script-results").first()).toContainText(
        "HTTP is OK",
      );
      const codeRect = await post.boundingBox();
      const paneRect = await page.locator(".request-editor").boundingBox();
      expect(
        codeRect &&
          paneRect &&
          Math.min(codeRect.y + codeRect.height, paneRect.y + paneRect.height) -
            codeRect.y,
      ).toBeGreaterThan(90);
      await page.screenshot({ path: `artifacts/scripts-${theme}.png` });
      await page
        .getByRole("button", { name: "GET Profile", exact: true })
        .click();
      await page.getByRole("button", { name: "Send ↗", exact: true }).click();
      await expect(
        page.getByRole("textbox", {
          name: "Response body editor",
          exact: true,
        }),
      ).toContainText("Bearer ui-chain-token");
      await page.reload();
      await expect
        .poll(
          async () => (await call("app_bootstrap")).workspace.globals[0]?.value,
        )
        .toBe("ui-chain-token");
      await page
        .getByRole("button", { name: "GET Login", exact: true })
        .click();
      await page
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page.getByRole("button", { name: "Scripts", exact: true }).click();
      await expect(
        page.getByRole("textbox", {
          name: "Post-response script",
          exact: true,
        }),
      ).toContainText("pm.globals.set");
      await page
        .getByRole("textbox", { name: "Post-response script", exact: true })
        .fill(
          'pm.globals.set("partial", "discard");\nthrow new Error("Missing expected token");',
        );
      await page.getByRole("button", { name: "Send ↗", exact: true }).click();
      await expect(page.locator(".script-results").first()).toContainText(
        "Post-response: Failed",
      );
      await expect(page.locator(".script-results").first()).toContainText(
        "Missing expected token",
      );
      await expect(
        page.getByRole("textbox", {
          name: "Response body editor",
          exact: true,
        }),
      ).toContainText("x-token");
      expect(
        (await call("app_bootstrap")).workspace.globals.some(
          (p: any) => p.key === "partial",
        ),
      ).toBe(false);
      await page.getByRole("tab", { name: "Pre-request", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Pre-request script", exact: true })
        .fill(
          'console.log("pre diagnostic");\nthrow new Error("Stop before HTTP");',
        );
      await page.getByRole("button", { name: "Send ↗", exact: true }).click();
      await expect(page.locator(".script-results").first()).toContainText(
        "Pre-request: Failed",
      );
      await expect(page.locator(".script-results").first()).toContainText(
        "pre diagnostic",
      );
      await expect(page.locator(".script-results").first()).toContainText(
        "Stop before HTTP",
      );
      await expect(
        page.getByRole("textbox", {
          name: "Response body editor",
          exact: true,
        }),
      ).toContainText("x-token");
    } finally {
      child.kill();
    }
  });
