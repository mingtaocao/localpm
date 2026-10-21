import { test, expect, type Page } from "@playwright/test";
import type { RequestSpec, Workspace, ResponseResult } from "../src/types";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

async function openEditors(page: Page, theme = "light") {
  const requests: RequestSpec[] = ["First", "Second"].map((name) => ({
    id: name,
    name,
    method: "POST",
    url: `https://example.test/${name}`,
    params: [],
    headers: [],
    auth: { type: "noauth" },
    body: {
      mode: "raw",
      raw: '{"nested":{"items":[1,2]},"name":"original"}',
      options: { raw: { language: "json" } },
    },
    settings: {},
    metadata: null,
  }));
  let workspace: Workspace = {
    collections: [],
    items: [],
    environments: [],
    globals: [],
    activeEnvironment: null,
    settings: { theme, language: "en-US" },
  };
  const response: ResponseResult = {
    status: 200,
    statusText: "OK",
    body: '{"nested":{"items":[1,2]},"name":"response"}',
    headers: [
      ["Content-Type", "application/json"],
      ["X-Trace", "trace"],
    ],
    contentType: "application/json",
    duration: 20,
    size: 55,
    finalUrl: "https://example.test",
    redirects: [],
    file: "response.json",
    binary: false,
    truncated: false,
  };
  await page.exposeBinding(
    "__editorInvoke",
    (_, command: string, args: any) => {
      if (command === "app_bootstrap")
        return { workspace, drafts: requests, history: [] };
      if (command === "save_workspace") {
        workspace = structuredClone(args.workspace);
        return workspace;
      }
      if (command === "send_request") return response;
      if (command === "get_history") return [];
      return null;
    },
  );
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) =>
        (window as any).__editorInvoke(command, args),
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Body", exact: true }).click();
}

for (const theme of ["light", "dark"]) {
  test(`${theme}: request and read-only response have focus, caret and matching brackets`, async ({
    page,
  }) => {
    await openEditors(page, theme);
    const request = page.getByRole("textbox", { name: "Request body editor" });
    await request.click();
    await request.press(`${modifier}+Home`);
    await request.press("ArrowRight");
    await expect(page.locator(".request-editor .cm-focused")).toHaveCount(1);
    await expect(
      page.locator(".request-editor .cm-matchingBracket"),
    ).toHaveCount(2);
    await expect(
      page.locator(".request-editor .code-editor-position"),
    ).toHaveText("Line 1, column 2");
    const cursor = page.locator(".request-editor .cm-cursor").first();
    await expect(cursor).toHaveCSS("border-left-width", "2px");
    const colors = await cursor.evaluate((element) => ({
      cursor: getComputedStyle(element).borderLeftColor,
      surface: getComputedStyle(
        document.querySelector(".request-editor .cm-content")!,
      ).backgroundColor,
    }));
    expect(colors.cursor).not.toBe(colors.surface);
    await page.getByRole("button", { name: "Send ↗", exact: true }).click();
    const response = page.getByRole("textbox", {
      name: "Response body editor",
    });
    await response.click();
    await response.press(`${modifier}+Home`);
    await response.press("ArrowRight");
    await expect(page.locator(".response .cm-matchingBracket")).toHaveCount(2);
    await expect(response).toHaveAttribute("aria-readonly", "true");
    await expect(response).toHaveAttribute("contenteditable", "true");
    const before = await response.innerText();
    await response.press("x");
    await response.press("Backspace");
    await response.press(`${modifier}+a`);
    await response.press("Delete");
    await expect.poll(() => response.innerText()).toBe(before);
    await page.screenshot({ path: `artifacts/editor-${theme}.png` });
  });
}

test("JSON format is undoable and invalid JSON leaves the document intact", async ({
  page,
}) => {
  await openEditors(page);
  const editor = page.getByRole("textbox", { name: "Request body editor" });
  const before = await editor.innerText();
  await page.getByRole("button", { name: "Format JSON", exact: true }).click();
  await expect(editor.locator(".cm-line")).not.toHaveCount(1);
  await editor.press(`${modifier}+z`);
  await expect(editor).toHaveText(before);
  await editor.fill('{"broken":');
  await page.getByRole("button", { name: "Format JSON", exact: true }).click();
  await expect(page.locator(".code-editor-error")).toContainText(
    "JSON format error",
  );
  await expect(page.locator(".code-editor-error")).not.toContainText("%{");
  await expect(editor).toHaveText('{"broken":');
});

test("text selection copies unchanged response and long request scroll survives a tab switch", async ({
  page,
}) => {
  await openEditors(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  const response = page.getByRole("textbox", { name: "Response body editor" });
  await response.click();
  await response.press(`${modifier}+a`);
  await response.press(`${modifier}+c`);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('"name": "response"');
  const request = page.getByRole("textbox", { name: "Request body editor" });
  await request.fill(
    JSON.stringify(
      Array.from({ length: 100 }, (_, index) => ({ index, name: "中文内容" })),
      null,
      2,
    ),
  );
  const scroller = page.locator(".request-editor .cm-scroller");
  await scroller.evaluate((element) => {
    element.scrollTop = 600;
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(500);
  const position = await scroller.evaluate((element) => element.scrollTop);
  await page
    .getByRole("button", { name: "Request tab: Second", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Request tab: First", exact: true })
    .click();
  await expect
    .poll(() =>
      scroller.evaluate(
        (element, savedPosition) => Math.abs(element.scrollTop - savedPosition),
        position,
      ),
    )
    .toBeLessThan(5);
  await expect(request).toContainText("中文内容");
});

test("request switches restore caret, folds and undo history; theme change preserves them", async ({
  page,
}) => {
  await openEditors(page);
  const editor = page.getByRole("textbox", { name: "Request body editor" });
  await page.getByRole("button", { name: "Format JSON", exact: true }).click();
  const formatted = await editor.innerText();
  await editor.click();
  await editor.press(`${modifier}+End`);
  await editor.press(" ");
  await page
    .locator(".request-editor")
    .getByRole("button", { name: "Editor actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Fold all", exact: true }).click();
  await expect(
    page.locator(".request-editor .cm-foldPlaceholder"),
  ).not.toHaveCount(0);
  await page
    .getByRole("button", { name: "Request tab: Second", exact: true })
    .click();
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await expect(page.locator(".request-editor .cm-foldPlaceholder")).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Request tab: First", exact: true })
    .click();
  await expect(
    page.locator(".request-editor .cm-foldPlaceholder"),
  ).not.toHaveCount(0);
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.locator(".request-editor .cm-foldPlaceholder"),
  ).not.toHaveCount(0);
  await page
    .locator(".request-editor")
    .getByRole("button", { name: "Editor actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Unfold all", exact: true }).click();
  await editor.press(`${modifier}+z`);
  await expect.poll(() => editor.innerText()).toBe(formatted);
});

test("response format and header search belong to the request tab", async ({
  page,
}) => {
  await openEditors(page);
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Response format", exact: true })
    .selectOption("Raw");
  await page
    .locator(".response")
    .getByRole("button", { name: "Headers", exact: true })
    .click();
  await page.getByPlaceholder("Filter headers").fill("X-Trace");
  await page
    .getByRole("button", { name: "Request tab: Second", exact: true })
    .click();
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Response format", exact: true }),
  ).toHaveValue("Pretty");
  await page
    .locator(".response")
    .getByRole("button", { name: "Headers", exact: true })
    .click();
  await expect(page.getByPlaceholder("Filter headers")).toHaveValue("");
  await page
    .getByRole("button", { name: "Request tab: First", exact: true })
    .click();
  await expect(page.getByPlaceholder("Filter headers")).toHaveValue("X-Trace");
  await page
    .getByRole("button", { name: "Response body", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Response format", exact: true }),
  ).toHaveValue("Raw");
  await expect(
    page.getByRole("textbox", { name: "Response body editor" }),
  ).toHaveText('{"nested":{"items":[1,2]},"name":"response"}');
});

test("search, wrapping and font controls stay usable in a small workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await openEditors(page);
  const pane = page.locator(".request-editor .code-editor");
  await pane.getByRole("button", { name: "Find", exact: true }).click();
  await pane.getByRole("textbox", { name: "Find", exact: true }).fill("items");
  await pane.getByRole("textbox", { name: "Find", exact: true }).press("Enter");
  await expect(pane.locator(".cm-searchMatch")).not.toHaveCount(0);
  await pane.getByRole("button", { name: "Word wrap", exact: true }).click();
  await expect(pane.locator(".cm-content")).toHaveClass(/cm-lineWrapping/);
  await page.getByRole("button", { name: "⚙ Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Editor font size", exact: true })
    .selectOption("18");
  await page.getByRole("button", { name: "Close ×", exact: true }).click();
  await expect(pane.locator(".cm-editor")).toHaveCSS("font-size", "18px");
  await expect(
    page.getByRole("button", { name: "Send ↗", exact: true }),
  ).toBeInViewport();
  await expect(pane.locator(".cm-content")).toBeInViewport();
  expect(
    await pane
      .locator(".cm-scroller")
      .evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(60);
  expect(
    await pane.locator(".cm-scroller").evaluate((element) => {
      const scroller = element.getBoundingClientRect();
      const panel = element.closest(".code-editor")!.getBoundingClientRect();
      const content = element
        .closest(".editor-content")!
        .getBoundingClientRect();
      return (
        Math.min(scroller.bottom, panel.bottom, content.bottom) -
        Math.max(scroller.top, panel.top, content.top)
      );
    }),
  ).toBeGreaterThan(60);
  await page.screenshot({ path: "artifacts/editor-small.png" });
});

function luminance(color: string) {
  const rgb = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number);
  const linear = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
for (const theme of ["light", "dark"]) {
  test(`${theme}: text selections remain visible in inputs and focused or blurred editors`, async ({
    page,
  }) => {
    await openEditors(page, theme);
    const url = page.getByLabel("Request URL", { exact: true });
    await url.focus();
    await url.press(`${modifier}+a`);
    const native = await url.evaluate((element) => {
      const style = getComputedStyle(element, "::selection");
      return {
        background: style.backgroundColor,
        text: style.color,
        surface: getComputedStyle(element).backgroundColor,
      };
    });
    expect(contrast(native.background, native.text)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(native.background, native.surface)).toBeGreaterThanOrEqual(
      2,
    );
    await page.getByRole("button", { name: "Send ↗", exact: true }).click();
    for (const scope of [".request-editor", ".response"]) {
      const editor = page.locator(`${scope} .cm-content`);
      await editor.click();
      await editor.press(`${modifier}+a`);
      const selection = page
        .locator(`${scope} .cm-selectionBackground`)
        .first();
      await expect(selection).toBeVisible();
      const colors = await selection.evaluate((element) => {
        const content = element
          .closest(".cm-editor")!
          .querySelector(".cm-content")!;
        return {
          selection: getComputedStyle(element).backgroundColor,
          surface: getComputedStyle(element.closest(".cm-editor")!)
            .backgroundColor,
          content: getComputedStyle(content).backgroundColor,
          text: getComputedStyle(
            content.querySelector(".cm-line span")!,
            "::selection",
          ).color,
          activeLine: getComputedStyle(content.querySelector(".cm-activeLine")!)
            .backgroundColor,
        };
      });
      expect(contrast(colors.selection, colors.surface)).toBeGreaterThanOrEqual(
        1.6,
      );
      expect(contrast(colors.selection, colors.text)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(colors.content).toBe("rgba(0, 0, 0, 0)");
      expect(colors.activeLine).toMatch(/^rgba\(.+, 0\.0/);
      await page.screenshot({
        path: `artifacts/selection-${theme}-${scope.slice(1)}.png`,
      });
      await url.focus();
      await expect(selection).toHaveCSS("background-color", colors.selection);
    }
  });
}

test("editor toolbars stay compact while folding and shared font settings remain accessible", async ({
  page,
}) => {
  await openEditors(page);
  const pane = page.locator(".request-editor .code-editor");
  await expect(
    pane.getByRole("combobox", { name: "Editor font size" }),
  ).toHaveCount(0);
  await expect(
    pane.getByRole("button", { name: "Fold all", exact: true }),
  ).toBeHidden();
  await expect(
    pane.getByRole("button", { name: "Find", exact: true }),
  ).toBeVisible();
  await pane.getByRole("button", { name: "Format JSON", exact: true }).click();
  await pane
    .getByRole("button", { name: "Editor actions", exact: true })
    .click();
  await pane.getByRole("button", { name: "Fold all", exact: true }).click();
  await expect(pane.locator(".cm-foldPlaceholder")).not.toHaveCount(0);
  await page.getByRole("button", { name: "⚙ Settings", exact: true }).click();
  await page.getByLabel("Editor font size", { exact: true }).selectOption("16");
  await page.getByRole("button", { name: "Close ×", exact: true }).click();
  await expect(pane.locator(".cm-editor")).toHaveCSS("font-size", "16px");
  await expect(pane.locator(".cm-foldPlaceholder")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(page.locator(".response .cm-editor")).toHaveCSS(
    "font-size",
    "16px",
  );
  await expect(
    page.locator(".code-editor-toolbar .code-editor-font"),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await expect(pane.locator(".cm-editor")).toHaveCSS("font-size", "16px");
});

for (const theme of ["light", "dark"]) {
  test(`${theme}: editor focus uses a single border and auxiliary actions are quiet`, async ({
    page,
  }) => {
    await openEditors(page, theme);
    const pane = page.locator(".request-editor .code-editor");
    await page.getByRole("textbox", { name: "Request body editor" }).click();
    await expect(pane).toHaveCSS("box-shadow", "none");
    await expect(pane).toHaveCSS("border-top-width", "1px");
    const colors = await pane.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--focus)";
      element.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).borderTopColor, expected };
    });
    expect(colors.actual).toBe(colors.expected);
    await expect(
      pane.getByRole("button", { name: "Find", exact: true }),
    ).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await page.getByRole("button", { name: "Send ↗", exact: true }).click();
    const recoveredNotice = page.locator(".toast:not(.error)");
    if (await recoveredNotice.count()) await recoveredNotice.click();
    await page.screenshot({
      path: `artifacts/experience-refinement-${theme}.png`,
    });
  });
}
