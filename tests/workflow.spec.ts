import { test, expect } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("full UI workflow using real Rust HTTP and SQLite, including backend restart", async ({
  page,
}) => {
  const data = mkdtempSync(join(tmpdir(), "lp-ui-"));
  let child: ChildProcessWithoutNullStreams;
  let counter = 0;
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: any) => void }
  >();
  function start() {
    child = spawn(resolve("src-tauri/target/debug/examples/test_bridge"), [], {
      env: { ...process.env, LOCAL_POSTMAN_DATA_DIR: data },
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const r = JSON.parse(line);
      const p = pending.get(r.id)!;
      pending.delete(r.id);
      if (r.error) p.reject(r.error);
      else p.resolve(r.value);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
  }
  start();
  let openPath = resolve("testdata/postman/basic.json");
  const exportPath = join(data, "export.json");
  await page.exposeBinding("__rustInvoke", async (_, cmd, args) => {
    if (cmd === "plugin:dialog|open") return openPath;
    if (cmd === "plugin:dialog|save") return exportPath;
    return new Promise((resolve, reject) => {
      const id = ++counter;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
    });
  });
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: any) =>
        (window as any).__rustInvoke(cmd, args),
    };
  });
  try {
    await page.goto("/");
    await expect(page.getByText("Your APIs. Your machine.")).toBeVisible();
    await page
      .getByRole("button", { name: "＋ Collection", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Acceptance API");
    await page.getByRole("button", { name: "Close ×" }).click();
    await page.getByRole("button", { name: "＋ Folder", exact: true }).click();
    await page.getByLabel("Folder name").fill("Echo requests");
    await page.getByRole("button", { name: "New request in folder" }).click();
    await page.getByLabel("Request name").fill("Saved echo");
    await page.getByLabel("Request URL").fill("http://127.0.0.1:47831/echo");
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await page.getByRole("button", { name: "Send ↗" }).click();
    await expect(page.getByText("200 OK", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Environments", exact: true })
      .click();
    await page
      .getByRole("button", { name: "＋ Environment", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("DEV");
    await page.getByRole("button", { name: "＋ Add row", exact: true }).click();
    await page.getByLabel("Key 1", { exact: true }).fill("host");
    await page
      .getByLabel("Value 1", { exact: true })
      .fill("http://127.0.0.1:47831");
    await page.getByRole("button", { name: "Close ×" }).click();
    await page.getByLabel("Request URL").fill("{{host}}/echo");
    await page.getByLabel("HTTP method").fill("POST");
    await page
      .getByRole("button", { name: "Headers", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "＋ Add row", exact: true }).click();
    await page.getByLabel("Key 1", { exact: true }).fill("X-Acceptance");
    await page.getByLabel("Value 1", { exact: true }).fill("verified");
    await page.getByRole("button", { name: "Body", exact: true }).click();
    await page.getByLabel("Body mode").selectOption("raw");
    await page.getByLabel("Raw language").selectOption("json");
    await page
      .locator(".request-editor .cm-content")
      .fill('{"message":"acceptance"}');
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await page.getByRole("button", { name: "Send ↗" }).click();
    await expect(page.locator(".response .cm-content")).toContainText(
      "acceptance",
    );
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.locator(".history-item")).toHaveCount(2);
    await page.getByRole("button", { name: "⚙ Settings" }).click();
    await page.getByRole("combobox", { name:"Proxy", exact: true }).selectOption("manual");
    await page
      .getByLabel("Proxy URL", { exact: true })
      .fill("http://127.0.0.1:47832");
    await page.getByRole("button", { name: "Close ×" }).click();
    await page.getByRole("button", { name: "Send ↗" }).click();
    await expect(page.locator(".response .cm-content")).toContainText(
      "x-via-local-proxy",
    );
    await page.getByRole("button", { name: "⚙ Settings" }).click();
    await page.getByLabel("No Proxy", { exact: true }).fill("127.0.0.*");
    await page.getByRole("button", { name: "Close ×" }).click();
    await page.getByRole("button", { name: "Send ↗" }).click();
    await expect(page.locator(".response .cm-content")).not.toContainText(
      "x-via-local-proxy",
    );
    await page
      .getByRole("button", { name: "Collections", exact: true })
      .click();
    await page.getByRole("button", { name: "↓ Import Postman" }).click();
    await expect(
      page.locator(".collection").filter({ hasText: "basic" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "GET Echo", exact: true }).click();
    await page.getByRole("button", { name: "Send ↗" }).click();
    await expect(page.getByText("200 OK", { exact: true })).toBeVisible();
    await page.locator(".collection").filter({ hasText: "basic" }).click();
    await page.getByRole("button", { name: "Export Postman v2.1" }).click();
    await expect
      .poll(() => {
        try {
          return JSON.parse(readFileSync(exportPath, "utf8")).info.name;
        } catch {
          return "";
        }
      })
      .toBe("basic");
    await page.screenshot({ path: "artifacts/ui-workflow.png" });
    await new Promise<void>((res) => {
      child.once("exit", () => res());
      child.stdin.end();
    });
    start();
    await page.reload();
    await expect(
      page.locator(".collection").filter({ hasText: "Acceptance API" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "▾ Echo requests" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "POST Saved echo", exact: true })
      .click();
    await expect(page.getByLabel("Request URL")).toHaveValue("{{host}}/echo");
    await expect(page.getByLabel("Active environment")).toContainText("DEV");
    await page.getByRole("button", { name: "Send ↗" }).click();
    await expect(page.getByText("200 OK", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.locator(".history-item")).toHaveCount(6);
    await page.screenshot({ path: "artifacts/ui-restart.png" });
  } finally {
    child.stdin.end();
  }
});
