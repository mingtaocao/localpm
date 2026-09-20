import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Backend = { restart: () => Promise<void>; read: () => Promise<any> };
const test = base.extend<{ backend: Backend }>({
  backend: async ({ page }, use) => {
    const data = mkdtempSync(join(tmpdir(), "lp-preferences-"));
    let child: ChildProcessWithoutNullStreams;
    let counter = 0;
    const pending = new Map<
      number,
      { resolve: (value: any) => void; reject: (reason: any) => void }
    >();
    const start = () => {
      child = spawn(
        resolve(
          "src-tauri/target/debug/examples/test_bridge" +
            (process.platform === "win32" ? ".exe" : ""),
        ),
        [],
        {
          env: { ...process.env, LOCAL_POSTMAN_DATA_DIR: data },
        },
      );
      createInterface({ input: child.stdout }).on("line", (line) => {
        const result = JSON.parse(line);
        const p = pending.get(result.id);
        pending.delete(result.id);
        if (result.error) p?.reject(result.error);
        else p?.resolve(result.value);
      });
      child.on("error", (e) => {
        for (const p of pending.values()) p.reject(e);
      });
      child.stderr.on("data", (data) => process.stderr.write(data));
    };
    const stop = () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.stdin.end();
      });
    const invoke = (cmd: string, args = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = ++counter;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
      });
    start();
    await page.exposeBinding("__rustInvoke", (_, cmd, args) =>
      invoke(cmd, args),
    );
    await page.addInitScript(() => {
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: any) =>
          (window as any).__rustInvoke(cmd, args),
      };
    });
    try {
      await use({
        restart: async () => {
          await stop();
          start();
        },
        read: () => invoke("app_bootstrap"),
      });
    } finally {
      await stop();
    }
  },
});

test("theme and language persist through Rust/SQLite restart without translating request data", async ({
  page,
  backend,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "⚙ Settings" }).click();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("system");
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Theme", { exact: true }).selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("所有数据仅保存在此设备", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("input").first()).toHaveCSS(
    "background-color",
    "rgb(41, 60, 49)",
  );
  await page.screenshot({ path: "artifacts/theme-dark-zh-settings.png" });
  await page.getByRole("button", { name: "关闭 ×" }).click();
  await page.getByRole("button", { name: "＋ 集合", exact: true }).click();
  await page
    .getByLabel("名称", { exact: true })
    .fill("Keep English 中文 {{host}}");
  await page.getByRole("button", { name: "关闭 ×" }).click();
  await page.getByRole("button", { name: "＋ 请求", exact: true }).click();
  await page.getByLabel("请求名称").fill("Untouched request 请求");
  await page.getByLabel("请求 URL").fill("http://127.0.0.1:47831/echo");
  await page.getByLabel("HTTP 方法").fill("POST");
  await page.getByRole("button", { name: "请求体", exact: true }).click();
  await page.getByLabel("请求体类型").selectOption("raw");
  await page.getByLabel("文本格式").selectOption("json");
  await page
    .locator(".request-editor .cm-content")
    .fill('{"message":"English 中文","Header":"Keep"}');
  await page.getByRole("button", { name: "保存 ⌘S" }).click();
  await page.getByRole("button", { name: "发送 ↗" }).click();
  await expect(page.getByText("200 OK", { exact: true })).toBeVisible();
  await expect(page.locator(".response .cm-content")).toContainText(
    "English 中文",
  );
  await expect(page.locator(".request-editor .cm-editor")).toHaveCSS(
    "background-color",
    "rgb(40, 44, 52)",
  );
  await expect(page.locator(".response .cm-editor")).toHaveCSS(
    "background-color",
    "rgb(40, 44, 52)",
  );
  await page.locator(".request-editor .cm-content").click();
  await page
    .locator(".request-editor .cm-content")
    .press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await expect(page.getByPlaceholder("查找")).toBeVisible();
  await page.getByLabel("关闭", { exact: true }).click();
  await page.screenshot({ path: "artifacts/theme-dark-zh-request.png" });
  await expect
    .poll(async () => (await backend.read()).workspace.settings.language)
    .toBe("zh-CN");
  const before = (await backend.read()).workspace;
  await backend.restart();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "POST Untouched request 请求", exact: true })
    .click();
  await expect(page.getByLabel("请求 URL")).toHaveValue(
    "http://127.0.0.1:47831/echo",
  );
  await page.getByRole("button", { name: "⚙ 设置" }).click();
  await page.getByLabel("语言", { exact: true }).selectOption("en-US");
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await page.getByRole("button", { name: "Close ×" }).click();
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await expect(page.locator(".request-editor .cm-content")).toContainText(
    '"message":"English 中文"',
  );
  await expect(page.locator(".request-editor .cm-editor")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await page.getByRole("button", { name: "Send ↗" }).click();
  await expect(page.locator(".response .cm-editor")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await page.screenshot({ path: "artifacts/theme-light-en-request.png" });
  await expect
    .poll(async () => (await backend.read()).workspace.settings.theme)
    .toBe("light");
  const after = (await backend.read()).workspace;
  expect(after.items).toEqual(before.items);
  expect(after.collections).toEqual(before.collections);
  expect(after.settings.proxy).toEqual(before.settings.proxy);
  await backend.restart();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test.describe("system language", () => {
  test.use({ locale: "zh-CN" });
  test("defaults to Chinese, follows language changes, and respects an explicit override", async ({
    page,
    backend,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "⚙ 设置" })).toBeVisible();
    await page.getByRole("button", { name: "⚙ 设置" }).click();
    await expect(page.getByLabel("语言", { exact: true })).toHaveValue(
      "system",
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, "languages", {
        configurable: true,
        value: ["en-US"],
      });
      window.dispatchEvent(new Event("languagechange"));
    });
    await expect(page.getByLabel("Language", { exact: true })).toBeVisible();
    await page.getByLabel("Language", { exact: true }).selectOption("en-US");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "languages", {
        configurable: true,
        value: ["zh-CN"],
      });
      window.dispatchEvent(new Event("languagechange"));
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect
      .poll(async () => (await backend.read()).workspace.settings.language)
      .toBe("en-US");
  });
});

test.describe("unsupported system language", () => {
  test.use({ locale: "fr-FR" });
  test("falls back to English with old settings", async ({ page, backend }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "⚙ Settings" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    expect((await backend.read()).workspace.settings.language).toBeUndefined();
  });
});
