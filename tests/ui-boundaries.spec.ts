import { test, expect } from "@playwright/test";
test("secret editing commits the complete value on blur", async ({ page }) => {
  await page.addInitScript(() => {
    const w: any = {
      collections: [],
      items: [],
      environments: [],
      globals: [],
      settings: { proxy: { mode: "off" }, historyLimit: 1000 },
      activeEnvironment: null,
    };
    (window as any).__savedSecrets = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        if (cmd === "app_bootstrap")
          return { workspace: w, drafts: [], history: [] };
        if (cmd === "save_workspace") {
          const copy = structuredClone(args.workspace);
          for (const p of copy.globals) {
            if (p.isSecret && p.value) {
              (window as any).__savedSecrets.push(p.value);
              p.secretRef = "test-ref";
              p.value = "";
            }
          }
          return copy;
        }
        return null;
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Show requests", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Global variables", exact: true })
    .click();
  await page.getByRole("button", { name: "＋ Add row", exact: true }).click();
  await page.getByLabel("Key 1", { exact: true }).fill("token");
  await page.getByLabel("Secret", { exact: true }).check();
  await page
    .getByLabel("Value 1", { exact: true })
    .pressSequentially("complete-secret-value", { delay: 25 });
  expect(await page.evaluate(() => (window as any).__savedSecrets)).toEqual([]);
  await page.getByLabel("Description 1", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__savedSecrets))
    .toEqual(["complete-secret-value"]);
});
test("10000 requests use bounded DOM and searchable virtual tree", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const items = Array.from({ length: 10000 }, (_, i) => ({
      id: `i${i}`,
      name: `Request ${i}`,
      collectionId: "c",
      parentId: null,
      kind: "request",
      order: i,
      auth: { type: "inherit" },
      metadata: null,
      request: {
        id: `r${i}`,
        name: `Request ${i}`,
        method: "GET",
        url: `http://localhost/item/${i}`,
        params: [],
        headers: [],
        auth: { type: "inherit" },
        body: { mode: "none" },
        settings: {},
        metadata: null,
      },
    }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async () => ({
        workspace: {
          collections: [
            {
              id: "c",
              name: "Large collection",
              variables: [],
              auth: { type: "noauth" },
              metadata: null,
            },
          ],
          items,
          environments: [],
          globals: [],
          settings: {},
          activeEnvironment: null,
        },
        drafts: [],
        history: [],
      }),
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Show requests", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "GET Request 0", exact: true }),
  ).toBeVisible();
  expect(await page.locator(".tree-row").count()).toBeLessThanOrEqual(50);
  await page.getByPlaceholder("Search name or URL  ⌘K").fill("Request 9999");
  await expect(
    page.getByRole("button", { name: "GET Request 9999", exact: true }),
  ).toBeVisible();
  expect(await page.locator(".tree-row").count()).toBe(2);
});

test("workspace divider resizes, supports keyboard, and restores its width", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async () => ({
        workspace: {
          collections: [],
          items: [],
          environments: [],
          globals: [],
          settings: {},
          activeEnvironment: null,
        },
        drafts: [],
        history: [],
      }),
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Show requests", exact: true })
    .click();
  const divider = page.getByRole("separator", {
    name: "Resize workspace panel",
  });
  await expect(divider).toHaveCSS("cursor", "col-resize");
  const box = await divider.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 100);
  await page.mouse.down();
  await page.mouse.move(380, box!.y + 100);
  await page.mouse.up();
  await expect(page.locator("aside")).toHaveCSS("width", "380px");
  await expect(divider).toHaveAttribute("aria-valuenow", "380");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("local-postman.sidebar-width"),
    ),
  ).toBe("380");

  await page.reload();
  await expect(
    page.getByRole("button", { name: "⚙ Settings", exact: true }),
  ).toBeVisible();
  const showRequests = page.getByRole("button", {
    name: "Show requests",
    exact: true,
  });
  if (await showRequests.count()) await showRequests.click();
  await expect(page.locator("aside")).toHaveCSS("width", "380px");
  await divider.focus();
  await divider.press("ArrowLeft");
  await expect(page.locator("aside")).toHaveCSS("width", "364px");
  await divider.press("Home");
  await expect(page.locator("aside")).toHaveCSS("width", "266px");
});
