import { test, expect, type Page } from "@playwright/test";

async function openRequests(
  page: Page,
  options: { count?: number; language?: string; theme?: string } = {},
) {
  await page.addInitScript(
    ({ count, language, theme }) => {
      const requests = Array.from({ length: count }, (_, index) => ({
        id: `navigation-${index}`,
        name:
          index === 1 || index === 2 ? "Project details" : `Request ${index}`,
        method: index === 1 ? "POST" : "GET",
        url: `https://example.test/v1/resources/${index}`,
        params: [],
        headers: [],
        auth: { type: "inherit" },
        body: { mode: "none" },
        settings: {},
        metadata: null,
      }));
      const workspace = {
        collections: [
          {
            id: "navigation",
            name: "Navigation API",
            auth: { type: "noauth" },
            variables: [],
            metadata: null,
          },
        ],
        items: requests.map((request, index) => ({
          id: `item-${index}`,
          name: request.name,
          collectionId: "navigation",
          parentId: null,
          kind: "request",
          order: index,
          auth: { type: "inherit" },
          request,
          metadata: null,
        })),
        environments: [],
        globals: [],
        activeEnvironment: null,
        settings: { language, theme },
      };
      const drafts = new Map(requests.map((request) => [request.id, request]));
      (window as any).__navigationDrafts = drafts;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          if (cmd === "app_bootstrap")
            return { workspace, drafts: [...drafts.values()], history: [] };
          if (cmd === "save_workspace") {
            Object.assign(workspace, args.workspace);
            return workspace;
          }
          if (cmd === "save_draft") {
            if (args.request) drafts.set(args.id, args.request);
            else drafts.delete(args.id);
          }
          if (cmd === "list_executions" || cmd === "get_history") return [];
          if (cmd === "send_request")
            return {
              status: 200,
              statusText: "OK",
              headers: [["Content-Type", "application/json"]],
              body: JSON.stringify({ request: args.request.id }),
              duration: 12,
              size: 32,
              contentType: "application/json",
              finalUrl: args.request.url,
              redirects: [],
              file: "navigation-response",
              binary: false,
              truncated: false,
            };
          return null;
        },
      };
    },
    {
      count: options.count ?? 16,
      language: options.language ?? "en-US",
      theme: options.theme ?? "light",
    },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Find open request", exact: true }),
  ).toBeVisible();
}

async function expectActiveVisible(page: Page) {
  await expect
    .poll(() =>
      page.locator(".tab.active").evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        const viewport = el
          .closest(".request-tab-list")!
          .getBoundingClientRect();
        return (
          bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1
        );
      }),
    )
    .toBe(true);
}

async function switchTo(page: Page, query: string) {
  await page
    .getByRole("button", { name: "Find open request", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Search open requests" })
    .fill(query);
  await page
    .getByRole("combobox", { name: "Search open requests" })
    .press("Enter");
}

test("overflow keeps new request and switcher visible, reveals active requests and supports manual scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 650 });
  await openRequests(page);
  await expectActiveVisible(page);
  const left = page.getByRole("button", { name: "Scroll tabs left" });
  const right = page.getByRole("button", { name: "Scroll tabs right" });
  await expect(left).toBeDisabled();
  await expect(right).toBeEnabled();
  await right.click();
  await expect
    .poll(() =>
      page.locator(".request-tab-list").evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(0);
  await left.click();
  await expect(left).toBeDisabled();
  await switchTo(page, "/resources/15");
  await expect(
    page.getByRole("textbox", { name: "Request name", exact: true }),
  ).toHaveValue("Request 15");
  await expectActiveVisible(page);
  await expect(right).toBeDisabled();
  const create = page.getByRole("button", { name: "New request", exact: true });
  await expect(create).toBeInViewport({ ratio: 1 });
  await create.click();
  await expect(page.locator(".tab")).toHaveCount(17);
  await expectActiveVisible(page);
  await page.locator(".tab.active .tab-close").click();
  await expect(page.locator(".tab")).toHaveCount(16);
  await expectActiveVisible(page);
  await page.getByRole("separator", { name: "Resize workspace panel" }).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator("aside")).toHaveCSS("width", "340px");
  await expectActiveVisible(page);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ width: 900, scroll: 900 });
});

test("request search distinguishes duplicate names by method and URL and handles no matches", async ({
  page,
}) => {
  await openRequests(page);
  await page
    .getByRole("button", { name: "Find open request", exact: true })
    .click();
  const search = page.getByRole("combobox", { name: "Search open requests" });
  await expect(search).toBeFocused();
  await expect(
    page.getByRole("listbox").getByRole("option", { selected: true }),
  ).toContainText("Request 0");
  await search.fill(" PROJECT DETAILS ");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
  await expect(
    page.getByRole("listbox").getByRole("option").first(),
  ).toContainText("POST");
  await expect(
    page.getByRole("listbox").getByRole("option").last(),
  ).toContainText("/resources/2");
  await search.press("ArrowDown");
  await expect(
    page.getByRole("listbox").getByRole("option", { selected: true }),
  ).toContainText("/resources/2");
  await search.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Switch request" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Request URL", exact: true }),
  ).toHaveValue("https://example.test/v1/resources/2");
  await expectActiveVisible(page);
  await page
    .getByRole("button", { name: "Find open request", exact: true })
    .click();
  await search.fill("post");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
  await search.fill("missing-endpoint");
  await expect(
    page.getByText("No open requests match your search."),
  ).toBeVisible();
  await search.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Switch request" }),
  ).toBeVisible();
  await search.fill("/resources/15");
  await page.getByRole("listbox").getByRole("option").click();
  await expectActiveVisible(page);
});

test("keyboard switching, dismissal and IME composition preserve focus and request selection", async ({
  page,
}) => {
  await openRequests(page);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const trigger = page.getByRole("button", {
    name: "Find open request",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press(`${modifier}+p`);
  const search = page.getByRole("combobox", { name: "Search open requests" });
  await expect(search).toBeFocused();
  await search.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close request switcher" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await search.fill("/resources/15");
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(
    page.getByRole("dialog", { name: "Switch request" }),
  ).toBeVisible();
  await search.press(`${modifier}+Enter`);
  await expect(
    page.getByRole("dialog", { name: "Switch request" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Response body editor", exact: true }),
  ).not.toBeVisible();
  await search.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.mouse.click(8, 8);
  await expect(
    page.getByRole("dialog", { name: "Switch request" }),
  ).not.toBeVisible();
  await page.keyboard.press(`${modifier}+PageUp`);
  await expect(
    page.getByRole("textbox", { name: "Request name", exact: true }),
  ).toHaveValue("Request 15");
  await expectActiveVisible(page);
  await page.keyboard.press(`${modifier}+PageDown`);
  await expect(
    page.getByRole("textbox", { name: "Request name", exact: true }),
  ).toHaveValue("Request 0");
  const first = page.getByRole("button", {
    name: "Request tab: Request 0",
    exact: true,
  });
  await first.focus();
  await first.press("End");
  await expect(
    page.getByRole("button", { name: "Request tab: Request 15", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("textbox", { name: "Request URL", exact: true }),
  ).toHaveValue("https://example.test/v1/resources/1");
});

test("search switching retains unsaved request edits, responses and recoverable closed drafts", async ({
  page,
}) => {
  await openRequests(page);
  await page
    .getByRole("textbox", { name: "Request URL", exact: true })
    .fill("https://example.test/edited");
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Response body editor", exact: true }),
  ).toContainText("navigation-0");
  await switchTo(page, "/resources/15");
  await switchTo(page, "/edited");
  await expect(
    page.getByRole("textbox", { name: "Request URL", exact: true }),
  ).toHaveValue("https://example.test/edited");
  await expect(
    page.getByRole("textbox", { name: "Response body editor", exact: true }),
  ).toContainText("navigation-0");
  await page
    .getByRole("button", { name: "Close request: Request 0", exact: true })
    .click();
  await expect(page.locator(".tab")).toHaveCount(15);
  await page
    .getByRole("button", { name: "GET Request 0", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Request URL", exact: true }),
  ).toHaveValue("https://example.test/edited");
  await expectActiveVisible(page);
});

for (const theme of ["light", "dark"]) {
  test(`small ${theme} workspace localizes the switcher and offers a clear empty workspace`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 640 });
    await openRequests(page, { count: 1, theme });
    await expect(
      page.getByRole("button", { name: "Scroll tabs right" }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Close request: Request 0", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Start a request" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Find open request", exact: true })
      .click();
    await expect(
      page.getByText("No open requests. Create one to get started."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "⚙ Settings", exact: true }).click();
    await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
    await page
      .getByRole("button", { name: "查找已打开的请求", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "切换请求" })).toBeInViewport(
      { ratio: 1 },
    );
    await expect(
      page.getByRole("combobox", { name: "搜索已打开的请求" }),
    ).toBeFocused();
    await expect(
      page.getByText("尚未打开请求，可以新建一个请求。"),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/ui-review/request-switcher-${theme}-zh.png`,
    });
  });
}
