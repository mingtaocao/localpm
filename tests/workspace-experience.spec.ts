import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import type { Workspace, RequestSpec, ResponseResult } from "../src/types";

const { version: appVersion } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const response: ResponseResult = {
  status: 500,
  statusText: "Internal Server Error",
  headers: [
    ["Content-Type", "application/json"],
    ["Set-Cookie", "session=review; Path=/; HttpOnly"],
  ],
  body: '{"error":"current-response"}',
  duration: 128,
  size: 28,
  contentType: "application/json",
  finalUrl: "https://example.test/users",
  redirects: [],
  file: "test-response",
  truncated: false,
  binary: false,
};

async function showSidebar(page: Page) {
  await expect(
    page.getByRole("button", { name: "⚙ Settings", exact: true }),
  ).toBeVisible();
  const show = page.getByRole("button", { name: "Show requests", exact: true });
  if (await show.count()) await show.click();
}

async function openMore(page: Page) {
  await page.getByRole("button", { name: "More actions", exact: true }).click();
}

async function saveRequest(page: Page) {
  await page
    .getByRole("button", { name: /^Save (?:⌘S|Ctrl\+S)$/, exact: true })
    .click();
  if (await page.getByLabel("Save location", { exact: true }).isVisible()) {
    await page
      .getByLabel("Save location", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByRole("button", { name: "Save request", exact: true })
      .click();
  }
}

async function openWorkspace(
  page: Page,
  options: {
    send?: (args: {
      request: RequestSpec;
      executionId: string;
      workspace?: Workspace;
    }) => Promise<ResponseResult>;
    cancel?: () => void | Promise<void>;
    save?: () => Promise<void>;
    draft?: (id: string, request: RequestSpec | null) => Promise<void>;
    theme?: string;
    openSavedRequest?: boolean;
    configure?: (workspace: Workspace) => void;
  } = {},
) {
  const request: RequestSpec = {
    id: "request",
    name: "Users",
    method: "GET",
    url: "https://example.test/users?page=1",
    params: [
      { key: "page", value: "1", enabled: true, description: "Page number" },
    ],
    headers: [],
    auth: { type: "inherit" },
    body: { mode: "none" },
    settings: {},
    metadata: null,
  };
  let workspace: Workspace = {
    collections: [
      {
        id: "collection",
        name: "API",
        auth: { type: "noauth" },
        variables: [],
        metadata: null,
      },
    ],
    items: [
      {
        id: "item",
        name: "Users",
        collectionId: "collection",
        parentId: null,
        kind: "request",
        order: 0,
        auth: { type: "inherit" },
        request,
        metadata: null,
      },
    ],
    environments: ["DEV", "STAGING"].map((name) => ({
      id: name,
      name,
      variables: [],
      settings: {},
      metadata: null,
    })),
    activeEnvironment: "DEV",
    globals: [],
    settings: { language: "en-US", theme: options.theme ?? "light" },
  };
  options.configure?.(workspace);
  const drafts = new Map<string, RequestSpec>();
  const draftWrites: Array<{ id: string; request: RequestSpec | null }> = [];
  await page.exposeBinding("__experienceInvoke", async (_, cmd, args) => {
    if (cmd === "app_bootstrap")
      return { workspace, drafts: [...drafts.values()], history: [] };
    if (cmd === "save_workspace") {
      await options.save?.();
      workspace = structuredClone(args.workspace);
      return workspace;
    }
    if (cmd === "save_draft") {
      await options.draft?.(args.id, args.request);
      if (args.request) drafts.set(args.id, structuredClone(args.request));
      else drafts.delete(args.id);
      draftWrites.push({ id: args.id, request: structuredClone(args.request) });
    }
    if (cmd === "send_request")
      return options.send ? options.send(args) : response;
    if (cmd === "cancel_request") return options.cancel?.();
    if (cmd === "get_history") return [];
    return null;
  });
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: any) =>
        (window as any).__experienceInvoke(cmd, args),
    };
  });
  await page.goto("/");
  if (options.openSavedRequest !== false) {
    await showSidebar(page);
    await page.getByRole("button", { name: "GET Users", exact: true }).click();
    await page
      .getByRole("button", { name: "Hide requests", exact: true })
      .click();
  }
  return { read: () => workspace, drafts, draftWrites };
}

test("editing then immediately switching tabs preserves the draft through reload", async ({
  page,
}) => {
  const backend = await openWorkspace(page);
  const url = "https://example.test/unsaved-before-switch";
  await page.getByLabel("Request URL", { exact: true }).fill(url);
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect.poll(() => backend.drafts.get("request")?.url).toBe(url);
  expect(backend.read().items[0].request?.url).not.toBe(url);
  await page.reload();
  await showSidebar(page);
  await page.getByRole("button", { name: "GET Users", exact: true }).click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    url,
  );
});

test("closing and reopening a collection request restores its retained draft", async ({
  page,
}) => {
  const backend = await openWorkspace(page);
  const url = "https://example.test/retained-after-close";
  await page.getByLabel("Request URL", { exact: true }).fill(url);
  await page.getByTitle("Close tab (draft retained)", { exact: true }).click();
  await expect.poll(() => backend.drafts.get("request")?.url).toBe(url);
  await showSidebar(page);
  await page.getByRole("button", { name: "GET Users", exact: true }).click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    url,
  );
  await expect(
    page.getByRole("button", { name: "Request tab: Users", exact: true }),
  ).toHaveAccessibleDescription("Unsaved changes");
});

test("an older draft write cannot resurrect a draft after explicit save", async ({
  page,
}) => {
  let finishDraft: () => void = () => {};
  let started = false;
  const backend = await openWorkspace(page, {
    draft: (_, request) =>
      request && !started
        ? new Promise<void>((resolve) => {
            started = true;
            finishDraft = resolve;
          })
        : Promise.resolve(),
  });
  const url = "https://example.test/explicitly-saved";
  await page.getByLabel("Request URL", { exact: true }).fill(url);
  await expect.poll(() => started).toBe(true);
  await saveRequest(page);
  await expect.poll(() => backend.read().items[0].request?.url).toBe(url);
  finishDraft();
  await expect.poll(() => backend.draftWrites.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".save-status")).toHaveText("Saved to API");
  expect(backend.drafts.has("request")).toBe(false);
});

test("editing and switching during slow close preserves the newest draft and current tab", async ({
  page,
}) => {
  let finishDraft: () => void = () => {};
  let writes = 0;
  const backend = await openWorkspace(page, {
    draft: (_, request) =>
      request && ++writes === 1
        ? new Promise<void>((resolve) => {
            finishDraft = resolve;
          })
        : Promise.resolve(),
  });
  await page
    .getByLabel("Request URL", { exact: true })
    .fill("https://example.test/before-close");
  await page.getByTitle("Close tab (draft retained)", { exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  const url = "https://example.test/edited-during-close";
  await page.getByLabel("Request URL", { exact: true }).fill(url);
  await page.getByRole("button", { name: "New request", exact: true }).click();
  finishDraft();
  await expect(
    page.getByRole("button", { name: "Request tab: Users", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue("");
  await expect.poll(() => backend.drafts.get("request")?.url).toBe(url);
  await showSidebar(page);
  await page.getByRole("button", { name: "GET Users", exact: true }).click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    url,
  );
});

test("sending freezes the clicked environment while draft persistence and UI changes continue", async ({
  page,
}) => {
  let saves = 0;
  let finishSave: () => void = () => {};
  let sentEnvironment: string | null | undefined;
  let sentUrl = "";
  const backend = await openWorkspace(page, {
    draft: () =>
      ++saves === 1
        ? new Promise<void>((resolve) => {
            finishSave = resolve;
          })
        : Promise.resolve(),
    send: async (args) => {
      const context = args.workspace ?? backend.read();
      sentEnvironment = context.activeEnvironment;
      sentUrl = args.request.url;
      return {
        ...response,
        finalUrl: `https://${sentEnvironment?.toLowerCase()}.test/users`,
      };
    },
  });
  await page.getByLabel("Request URL", { exact: true }).fill("{{host}}/users");
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  await page
    .getByLabel("Active environment", { exact: true })
    .selectOption("STAGING");
  await page
    .getByLabel("Request URL", { exact: true })
    .fill("{{host}}/changed-during-send");
  finishSave();
  await expect(
    page.getByRole("button", { name: "Send ↗", exact: true }),
  ).toBeVisible();
  expect(sentEnvironment).toBe("DEV");
  expect(sentUrl).toBe("{{host}}/users");
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("STAGING");
  await expect(page.locator(".response-context")).toContainText("DEV");
});

test("a failed close retains the editable tab and allows retry", async ({
  page,
}) => {
  let failWrite = true;
  const backend = await openWorkspace(page, {
    draft: async () => {
      if (failWrite) throw { code: "SAVE_ERROR", message: "Disk full" };
    },
  });
  const url = "https://example.test/keep-after-failure";
  await page.getByLabel("Request URL", { exact: true }).fill(url);
  await page.getByTitle("Close tab (draft retained)", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("SAVE_ERROR");
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    url,
  );
  await expect(
    page.getByRole("button", { name: "Request tab: Users", exact: true }),
  ).toHaveAccessibleDescription("Unsaved changes");
  failWrite = false;
  await page.getByTitle("Close tab (draft retained)", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Request tab: Users", exact: true }),
  ).toHaveCount(0);
  expect(backend.drafts.get("request")?.url).toBe(url);
});

test("draft autosave preserves the collection and the newer environment selection", async ({
  page,
}) => {
  const backend = await openWorkspace(page);
  await page.getByLabel("Value 1", { exact: true }).fill("2");
  await page
    .getByLabel("Active environment", { exact: true })
    .selectOption("STAGING");
  await expect
    .poll(() => backend.drafts.get("request")?.params[0].value)
    .toBe("2");
  await page.waitForTimeout(2300); // The removed collection autosave used to fire after 2 seconds.
  await expect(page.locator(".save-status")).toHaveText("Unsaved changes");
  expect(backend.read().items[0].request?.params[0].value).toBe("1");
  expect(backend.read().activeEnvironment).toBe("STAGING");
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("STAGING");
});

test("starts with discoverable requests and method selection in the workspace", async ({
  page,
}) => {
  await openWorkspace(page, { openSavedRequest: false });
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("HTTP method", { exact: true })).toHaveValue(
    "GET",
  );
  await expect(
    page.getByRole("button", { name: "Send ↗", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Hide requests", exact: true }),
  ).toBeVisible();
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator(".editor-content")).toBeVisible();
  await expect(page.locator(".request-tabs")).toHaveCount(1);
  await expect(page.locator(".welcome")).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  for (const name of ["Params", "Headers", "Body", "Authorization"]) {
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-expanded", name === "Params" ? "true" : "false");
  }
  await showSidebar(page);
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hide requests", exact: true })
    .click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue("");
});

test("configuration can be collapsed without losing parameters or body data", async ({
  page,
}) => {
  await openWorkspace(page);
  const params = page.getByRole("button", { name: "Params", exact: true });
  await params.click();
  await page.getByLabel("Value 1", { exact: true }).fill("7");
  await page
    .getByRole("button", { name: "Collapse configuration", exact: true })
    .click();
  await expect(page.getByLabel("Value 1", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    "https://example.test/users?page=7",
  );
  await params.click();
  await expect(page.getByLabel("Value 1", { exact: true })).toHaveValue("7");
  const body = page.getByRole("button", { name: "Body", exact: true });
  await body.click();
  await page.getByLabel("Body mode", { exact: true }).selectOption("raw");
  await page.getByLabel("Raw language", { exact: true }).selectOption("json");
  await page.locator(".request-editor .cm-content").fill('{"keep":"my draft"}');
  await page
    .getByRole("button", { name: "Collapse configuration", exact: true })
    .click();
  await expect(page.locator(".request-editor .cm-content")).toBeHidden();
  await body.click();
  await expect(page.locator(".request-editor .cm-content")).toContainText(
    '"keep":"my draft"',
  );
});

test("duplicating before autosave preserves the current request name, URL and body", async ({
  page,
}) => {
  const backend = await openWorkspace(page);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  const editedUrl = "https://draft.example.test/edited?fresh=1";
  const editedBody = '{"source":"unsaved changes"}';
  await page.getByLabel("Request name", { exact: true }).fill("Edited users");
  await page.getByLabel("Request URL", { exact: true }).fill(editedUrl);
  await page.getByLabel("HTTP method", { exact: true }).selectOption("POST");
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await page.getByLabel("Body mode", { exact: true }).selectOption("raw");
  await page.getByLabel("Raw language", { exact: true }).selectOption("json");
  await page.locator(".request-editor .cm-content").fill(editedBody);
  expect(backend.read().items[0].request?.name).toBe("Users");
  await openMore(page);
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();

  await showSidebar(page);
  const copy = page.locator("aside").getByRole("button", {
    name: "POST Edited users copy",
    exact: true,
  });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByLabel("Request name", { exact: true })).toHaveValue(
    "Edited users copy",
  );
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    editedUrl,
  );
  await expect(page.getByLabel("HTTP method", { exact: true })).toHaveValue(
    "POST",
  );
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await expect(page.getByLabel("Raw language", { exact: true })).toHaveValue(
    "json",
  );
  await expect(page.locator(".request-editor .cm-content")).toHaveText(
    editedBody,
    { useInnerText: true },
  );
});

test("switching request tabs restores each request's collection variables and scripts", async ({
  page,
}) => {
  await openWorkspace(page, {
    configure: (workspace) => {
      const variable = (value: string) => ({
        key: "host",
        value,
        enabled: true,
        description: "",
      });
      workspace.collections[0].variables = [
        variable("https://users.collection.test"),
      ];
      workspace.items[0].request!.url = "{{host}}/users";
      workspace.items[0].request!.params = [];
      workspace.items[0].metadata = {
        event: [
          { listen: "prerequest", script: { exec: ["users-only-script"] } },
        ],
      };
      workspace.collections.push({
        id: "orders-collection",
        name: "Orders API",
        auth: { type: "noauth" },
        variables: [variable("https://orders.collection.test")],
        metadata: null,
      });
      workspace.items.push({
        id: "orders-item",
        name: "Orders",
        collectionId: "orders-collection",
        parentId: null,
        kind: "request",
        order: 0,
        auth: { type: "inherit" },
        request: {
          ...structuredClone(workspace.items[0].request!),
          id: "orders-request",
          name: "Orders",
          url: "{{host}}/orders",
        },
        metadata: {
          event: [
            { listen: "prerequest", script: { exec: ["orders-only-script"] } },
          ],
        },
      });
    },
  });
  await showSidebar(page);
  await page.getByRole("button", { name: "GET Orders", exact: true }).click();
  const tabs = page.locator(".request-tabs");
  await tabs
    .getByRole("button", { name: "Request tab: Users", exact: true })
    .click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveAttribute(
    "title",
    /https:\/\/users\.collection\.test/,
  );
  await expect(
    page.getByLabel("Request URL", { exact: true }),
  ).not.toHaveAttribute("title", /https:\/\/orders\.collection\.test/);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Pre-request", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Pre-request script editor",
      exact: true,
    }),
  ).toContainText("users-only-script");
  await expect(
    page.getByRole("textbox", {
      name: "Pre-request script editor",
      exact: true,
    }),
  ).not.toContainText("orders-only-script");

  await tabs
    .getByRole("button", { name: "Request tab: Orders", exact: true })
    .click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveAttribute(
    "title",
    /https:\/\/orders\.collection\.test/,
  );
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Pre-request", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Pre-request script editor",
      exact: true,
    }),
  ).toContainText("orders-only-script");
  await expect(
    page.getByRole("textbox", {
      name: "Pre-request script editor",
      exact: true,
    }),
  ).not.toContainText("users-only-script");
});

test("more actions opens by keyboard and dismisses after Escape, outside interaction and actions", async ({
  page,
}) => {
  await openWorkspace(page);
  const more = page.getByRole("button", { name: "More actions", exact: true });
  const copy = page.getByRole("button", { name: "Copy cURL", exact: true });
  await expect(copy).toBeHidden();
  await more.focus();
  await more.press("Enter");
  await expect(copy).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(copy).toBeHidden();
  await more.click();
  await page.getByLabel("Request URL", { exact: true }).click();
  await expect(copy).toBeHidden();
  await more.click();
  await page
    .getByRole("button", { name: "Request settings", exact: true })
    .click();
  await expect(copy).toBeHidden();
  await expect(page.locator(".advanced-heading")).toContainText(
    "Request settings",
  );
});

test("response formats, headers, cookies and save remain usable with a minimum-height response pane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await openWorkspace(page);
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  const pane = page.locator(".response");
  const body = pane.locator(".cm-content");
  const format = pane.getByLabel("Response format", { exact: true });
  const prettyBody = JSON.stringify(JSON.parse(response.body), null, 2);
  await expect(format).toHaveValue("Pretty");
  await expect(body).toHaveText(prettyBody, { useInnerText: true });
  await format.selectOption("Raw");
  await expect(body).toHaveText(response.body, { useInnerText: true });

  await page.getByRole("button", { name: "Params", exact: true }).click();
  const divider = page.getByRole("separator", {
    name: "Resize request and response",
    exact: true,
  });
  for (let i = 0; i < 8; i++) await divider.press("ArrowDown");
  await expect
    .poll(async () => (await pane.boundingBox())?.height ?? 0)
    .toBeLessThanOrEqual(160);
  await expect(pane).toBeInViewport();

  await pane.getByRole("button", { name: "Headers", exact: true }).click();
  await expect(pane.getByText("Content-Type", { exact: true })).toBeVisible();
  await expect(pane.getByText("Set-Cookie", { exact: true })).toBeVisible();
  const filter = pane.getByPlaceholder("Filter headers", { exact: true });
  await filter.fill("application/json");
  await expect(pane.getByText("Content-Type", { exact: true })).toBeVisible();
  await expect(pane.getByText("Set-Cookie", { exact: true })).toBeHidden();
  await filter.clear();

  const actions = pane.getByRole("button", {
    name: "Response actions",
    exact: true,
  });
  await actions.click();
  await pane.getByRole("button", { name: "Cookies", exact: true }).click();
  await expect(pane.getByText("Content-Type", { exact: true })).toBeHidden();
  await expect(pane.getByText("Set-Cookie", { exact: true })).toBeVisible();
  await filter.fill("missing-cookie");
  await expect(pane.getByText("Set-Cookie", { exact: true })).toBeHidden();
  await filter.fill("session");
  await expect(
    pane.getByText("session=review; Path=/; HttpOnly", { exact: true }),
  ).toBeVisible();

  await pane
    .getByRole("button", { name: "Response body", exact: true })
    .click();
  await expect(format).toHaveValue("Raw");
  await expect(body).toHaveText(response.body, { useInnerText: true });
  await format.selectOption("Pretty");
  await expect(body).toHaveText(prettyBody, { useInnerText: true });

  await actions.click();
  const saveAs = pane.getByRole("button", { name: "Save as…", exact: true });
  await expect(saveAs).toBeVisible();
  const saveBox = await saveAs.boundingBox();
  expect(saveBox).not.toBeNull();
  expect(saveBox!.y).toBeGreaterThanOrEqual(0);
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(640);
  await saveAs.click();
  await expect(saveAs).toBeHidden();
  await expect(body).toHaveText(prettyBody, { useInnerText: true });
});

test("minimum window retains request, response and console controls, including compact controls and resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await openWorkspace(page);
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(
    page.getByText("500 Internal Server Error", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".metrics b")).toHaveCSS(
    "color",
    "rgb(189, 68, 68)",
  );
  await page.getByRole("button", { name: "Console", exact: false }).click();
  const checkLayout = async () => {
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const box = (selector: string) =>
            document.querySelector(selector)!.getBoundingClientRect();
          const result = box(".response");
          const console = box(".console");
          const send = box(".url-bar .primary");
          return (
            result.height >= 160 &&
            result.bottom <= console.top + 1 &&
            send.bottom < result.top &&
            console.bottom <= innerHeight
          );
        }),
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Close console", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Send ↗", exact: true }),
    ).toBeInViewport();
    await expect(page.locator(".response .cm-content")).toBeInViewport();
  };
  await checkLayout();
  await page
    .getByRole("separator", { name: "Resize console", exact: true })
    .press("ArrowUp");
  await checkLayout();
  await page
    .getByRole("separator", { name: "Resize console", exact: true })
    .press("ArrowUp");
  await checkLayout();
  await page.setViewportSize({ width: 1280, height: 850 });
  await checkLayout();
  await page
    .getByRole("separator", { name: "Resize console", exact: true })
    .press("ArrowUp");
  await checkLayout();
  await page.setViewportSize({ width: 900, height: 640 });
  await checkLayout();
  await page.screenshot({ path: "artifacts/workspace-minimum-console.png" });
  await page
    .getByRole("button", { name: "Close console", exact: true })
    .click();
  await expect(page.locator(".console")).toHaveCount(0);
});

test("a new execution preserves the previous response and network failure keeps diagnostics optional", async ({
  page,
}) => {
  let calls = 0;
  let rejectSend: (reason: unknown) => void = () => {};
  await openWorkspace(page, {
    send: () =>
      ++calls === 1
        ? Promise.resolve({ ...response, status: 200, statusText: "OK" })
        : new Promise((_, reject) => {
            rejectSend = reject;
          }),
  });
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(page.locator(".response .cm-content")).toContainText(
    "current-response",
  );
  await expect(page.locator(".response-context")).toContainText("DEV");
  await page
    .getByLabel("Active environment", { exact: true })
    .selectOption("STAGING");
  await expect(page.locator(".response-context")).toContainText("DEV");
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(
    page.getByText("Sending request…", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".response .cm-content")).toContainText(
    "current-response",
  );
  await expect(page.locator(".response-context").first()).toContainText("DEV");
  await expect(
    page.getByText("Previous response", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => calls).toBe(2);
  rejectSend({ code: "NETWORK_ERROR", message: "Connection refused" });
  await expect(page.locator(".response [role=alert]")).toContainText(
    "NETWORK_ERROR",
  );
  await expect(page.locator(".response .metrics")).toContainText("200 OK");
  await expect(page.locator(".response .cm-content")).toContainText(
    "current-response",
  );
  await expect(page.locator(".console")).toHaveCount(0);
  await page
    .getByRole("button", { name: "View diagnostics", exact: true })
    .click();
  await expect(page.locator(".console")).toBeVisible();
  await page.locator(".console-entry").first().locator("summary").click();
  await expect(page.locator(".console-details").first()).toContainText(
    "Connection refused",
  );
});

for (const language of ["en-US", "zh-CN"]) {
  test(`${language}: cancellation retains the previous response and a successful retry replaces it`, async ({
    page,
  }) => {
    let calls = 0;
    let rejectSend: (reason: unknown) => void = () => {};
    await openWorkspace(page, {
      configure: (workspace) => {
        workspace.settings.language = language;
      },
      // Open the collection request after bootstrap using the translated label.
      openSavedRequest: false,
      send: () => {
        calls++;
        if (calls === 2)
          return new Promise((_, reject) => {
            rejectSend = reject;
          });
        return Promise.resolve({
          ...response,
          body: calls === 1 ? '"first-result"' : '"new-result"',
        });
      },
      cancel: () =>
        rejectSend({ code: "REQUEST_CANCELLED", message: "Request cancelled" }),
    });
    await page.getByRole("button", { name: "GET Users", exact: true }).click();
    const chinese = language === "zh-CN";
    const send = page.getByRole("button", {
      name: chinese ? "发送 ↗" : "Send ↗",
      exact: true,
    });
    const body = page.locator(".response .cm-content");
    await send.click();
    await expect(body).toContainText("first-result");
    await send.click();
    await expect.poll(() => calls).toBe(2);
    await page
      .getByRole("button", { name: chinese ? "取消" : "Cancel", exact: true })
      .click();
    await expect(page.locator(".response [role=status]")).toHaveText(
      chinese ? "请求已取消。" : "Request cancelled.",
    );
    await expect(page.locator(".response [role=alert]")).toHaveCount(0);
    await expect(body).toContainText("first-result");
    await expect(
      page.getByText(chinese ? "上次响应" : "Previous response", {
        exact: true,
      }),
    ).toBeVisible();
    await send.click();
    await expect(body).toContainText("new-result");
    await expect(
      page.getByText(chinese ? "上次响应" : "Previous response", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator(".response [role=status]")).toHaveCount(0);
  });
}

test("cancelling while draft persistence is pending prevents the network send", async ({
  page,
}) => {
  let finishSave: () => void = () => {};
  let saves = 0;
  let sends = 0;
  await openWorkspace(page, {
    draft: () =>
      new Promise<void>((resolve) => {
        saves++;
        finishSave = resolve;
      }),
    send: async () => {
      sends++;
      return response;
    },
  });
  await page
    .getByLabel("Request URL", { exact: true })
    .fill("https://example.test/unsaved-cancel");
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  finishSave();
  await expect(page.locator(".response [role=status]")).toHaveText(
    "Request cancelled.",
  );
  await expect(
    page.getByRole("button", { name: "Send ↗", exact: true }),
  ).toBeVisible();
  expect(sends).toBe(0);
});

test("rapid send shortcuts start only one execution", async ({ page }) => {
  let sends = 0;
  let finishSend: (result: ResponseResult) => void = () => {};
  await openWorkspace(page, {
    send: () => {
      sends++;
      return new Promise((resolve) => {
        finishSend = resolve;
      });
    },
  });
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++)
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
      );
  });
  await expect.poll(() => sends).toBe(1);
  finishSend(response);
  await expect(page.locator(".response .cm-content")).toContainText(
    "current-response",
  );
  expect(sends).toBe(1);
});

test("a closed execution cannot overwrite or unlock a reopened request", async ({
  page,
}) => {
  const pending: Array<(result: ResponseResult) => void> = [];
  await openWorkspace(page, {
    send: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  });
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect.poll(() => pending.length).toBe(1);
  await page.getByTitle("Close tab (draft retained)", { exact: true }).click();
  await showSidebar(page);
  await page.getByRole("button", { name: "GET Users", exact: true }).click();
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect.poll(() => pending.length).toBe(2);
  pending[0]({ ...response, body: '"old-result"' });
  // The Console confirms completion of the old promise, including its finally block.
  await openMore(page);
  await page.getByRole("button", { name: "Console", exact: false }).click();
  await expect(page.locator(".console-entry").last()).toContainText("500");
  await expect(page.locator(".response .cm-content")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  pending[1]({ ...response, body: '"new-result"' });
  await expect(page.locator(".response .cm-content")).toContainText(
    "new-result",
  );
  await expect(
    page.getByRole("button", { name: "Send ↗", exact: true }),
  ).toBeVisible();
});

test("environment inspection and editing never activates it, and deleting another environment retains the active one", async ({
  page,
}) => {
  const backend = await openWorkspace(page);
  await showSidebar(page);
  await page.getByRole("button", { name: "Environments", exact: true }).click();
  await page.getByRole("button", { name: "◇ STAGING", exact: true }).click();
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("DEV");
  await page.getByLabel("Name", { exact: true }).fill("Preview staging");
  await expect
    .poll(() => backend.read().environments[1].name)
    .toBe("Preview staging");
  expect(backend.read().activeEnvironment).toBe("DEV");
  await page
    .getByRole("button", { name: "Use environment", exact: true })
    .click();
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("STAGING");
  await page
    .getByLabel("Active environment", { exact: true })
    .selectOption("DEV");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Preview staging",
  );
  await page
    .getByRole("button", { name: "Delete environment", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => backend.read().environments.length).toBe(1);
  expect(backend.read().activeEnvironment).toBe("DEV");
  await page
    .getByRole("button", { name: "＋ Environment", exact: true })
    .click();
  await expect(
    page.getByLabel("Active environment", { exact: true }),
  ).toHaveValue("DEV");
  await page
    .getByRole("button", { name: "Use environment", exact: true })
    .click();
  await expect.poll(() => backend.read().activeEnvironment).not.toBe("DEV");
});

test("saved collection edits and unsaved drafts have quiet, distinct persistence feedback", async ({
  page,
}) => {
  const backend = await openWorkspace(page);
  await page.getByLabel("Request name", { exact: true }).fill("Updated users");
  await expect(page.locator(".save-status")).toHaveText("Unsaved changes");
  await expect
    .poll(() => backend.drafts.get("request")?.name)
    .toBe("Updated users");
  await expect(page.locator(".save-status")).toHaveText("Unsaved changes");
  expect(backend.read().items[0].request?.name).toBe("Users");
  await saveRequest(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to API");
  expect(backend.read().items[0].request?.name).toBe("Updated users");
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Draft saved locally");
  expect(
    [...backend.drafts.values()].some(
      (draft) => draft.name === "Untitled request",
    ),
  ).toBe(true);
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("save failure stays visible and parameter headers share the input column positions", async ({
  page,
}) => {
  await openWorkspace(page, {
    save: async () => {
      throw { code: "SAVE_ERROR", message: "Disk full" };
    },
  });
  await page.getByRole("button", { name: "Params", exact: true }).click();
  const positions = await page.locator(".kv").evaluate((element) => {
    const labels = [...element.querySelectorAll(".kv-label span")].slice(1, 4);
    const inputs = [
      ...element.querySelectorAll('.kv-row input:not([type="checkbox"])'),
    ];
    return labels.map((label, i) =>
      Math.abs(
        label.getBoundingClientRect().x - inputs[i].getBoundingClientRect().x,
      ),
    );
  });
  expect(positions.every((offset) => offset < 1)).toBe(true);
  await page.getByLabel("Value 1", { exact: true }).fill("2");
  await saveRequest(page);
  await expect(page.locator(".save-status")).toHaveText("Save failed");
  await expect(page.getByRole("alert")).toContainText("SAVE_ERROR");
});

test("editing during an in-flight save retains the newer draft and does not mark it saved", async ({
  page,
}) => {
  let finishSave: () => void = () => {};
  let saves = 0;
  const backend = await openWorkspace(page, {
    save: () =>
      ++saves === 1
        ? new Promise<void>((resolve) => {
            finishSave = resolve;
          })
        : Promise.resolve(),
  });
  await page.getByRole("button", { name: "Params", exact: true }).click();
  await page.getByLabel("Value 1", { exact: true }).fill("2");
  await saveRequest(page);
  await expect(page.locator(".save-status")).toHaveText("Saving…");
  await page.getByLabel("Value 1", { exact: true }).fill("3");
  finishSave();
  await expect
    .poll(() => backend.drafts.get("request")?.params[0].value)
    .toBe("3");
  await expect(page.locator(".save-status")).toHaveText("Unsaved changes");
  expect(backend.read().items[0].request?.params[0].value).toBe("2");
  await saveRequest(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to API");
  expect(backend.read().items[0].request?.params[0].value).toBe("3");
});

for (const theme of ["light", "dark"]) {
  test(`resource navigation and response metrics remain usable in ${theme} mode`, async ({
    page,
  }) => {
    let sends = 0;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkspace(page, {
      theme,
      send: async () => ({
        ...response,
        status: 200,
        statusText: "OK",
        duration: ++sends === 1 ? 128 : 45,
        size: sends === 1 ? 2048 : 512,
      }),
    });
    await showSidebar(page);
    const history = page.getByRole("button", { name: "History", exact: true });
    await history.focus();
    await page.keyboard.press("Enter");
    await expect(history).toHaveAttribute("aria-current", "true");
    await page
      .getByRole("button", { name: "Collections", exact: true })
      .click();
    const params = page.getByRole("button", { name: "Params", exact: true });
    await params.focus();
    await page.keyboard.press("Enter");
    await expect(params).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Value 1", { exact: true })).toHaveValue("1");
    await page.getByRole("button", { name: "Send ↗", exact: true }).click();
    const counters = page.locator(".metrics > span");
    await expect(counters).toHaveText(["128 ms", "2.00 KB"]);
    await page.getByRole("button", { name: "Send ↗", exact: true }).click();
    await expect(counters).toHaveText(["45 ms", "0.50 KB"]);
    await page.screenshot({ path: `artifacts/modern-ui-${theme}.png` });
    await page.setViewportSize({ width: 900, height: 640 });
    await expect(
      page.getByRole("button", { name: "Authorization", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "More actions", exact: true }),
    ).toBeInViewport();
  });
}

test("resource switches preserve collection expansion and visible environment entries", async ({
  page,
}) => {
  await openWorkspace(page);
  await showSidebar(page);
  const collapse = page.getByRole("button", {
    name: "Collapse API",
    exact: true,
  });
  await collapse.click();
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Environments", exact: true }).click();
  const dev = page
    .locator("aside .resource-content:not([hidden]) .tree-item")
    .filter({ hasText: "DEV" });
  await expect(dev).toBeVisible();
  await expect(dev).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Collections", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Expand API", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand API", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeVisible();
});

test("panel sizes and Console visibility recover safely after reload", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Params", exact: true }).click();
  const split = page.getByRole("separator", {
    name: "Resize request and response",
  });
  await split.press("ArrowDown");
  const savedEditor = await split.getAttribute("aria-valuenow");
  await page.getByRole("button", { name: "Console", exact: false }).click();
  const consoleSplit = page.getByRole("separator", { name: "Resize console" });
  await consoleSplit.press("ArrowUp");
  const savedConsole = await consoleSplit.getAttribute("aria-valuenow");
  await page.reload();
  await expect(
    page.getByRole("separator", { name: "Resize console" }),
  ).toHaveAttribute("aria-valuenow", savedConsole!);
  await page.getByRole("button", { name: "Close console" }).click();
  await page.getByRole("button", { name: "Params", exact: true }).click();
  await expect(split).toHaveAttribute("aria-valuenow", savedEditor!);
  await page.evaluate(() => {
    localStorage.setItem("local-postman.sidebar-width", "Infinity");
    localStorage.setItem("localpm-console-height", "not-a-number");
    localStorage.setItem("localpm-editor-height", "-100");
  });
  await page.reload();
  await showSidebar(page);
  await expect(page.locator("aside")).toHaveCSS("width", "260px");
});

for (const theme of ["light", "dark"]) {
  for (const language of ["en-US", "zh-CN"]) {
    test(`modern UI window matrix ${theme} ${language}`, async ({ page }) => {
      await openWorkspace(page, {
        theme,
        openSavedRequest: false,
        configure: (w) => {
          w.settings.language = language;
        },
      });
      const chinese = language === "zh-CN";
      await page
        .getByRole("button", { name: chinese ? "参数" : "Params", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: chinese ? "更多操作" : "More actions",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: chinese ? "控制台" : "Console",
          exact: false,
        })
        .click();
      for (const [width, height] of [
        [900, 640],
        [1280, 800],
        [1440, 900],
        [1920, 1080],
      ]) {
        await page.setViewportSize({ width, height });
        await expect(
          page.getByRole("button", {
            name: chinese ? "发送 ↗" : "Send ↗",
            exact: true,
          }),
        ).toBeInViewport();
        await expect(
          page.getByRole("button", {
            name: chinese ? "关闭控制台" : "Close console",
            exact: true,
          }),
        ).toBeInViewport();
        await expect
          .poll(() =>
            page.evaluate(() => {
              const response = document
                .querySelector(".response")!
                .getBoundingClientRect();
              const console = document
                .querySelector(".console")!
                .getBoundingClientRect();
              const editor = document
                .querySelector(".request-editor")!
                .getBoundingClientRect();
              return (
                response.height >= 160 &&
                editor.height >= 180 &&
                response.bottom <= console.top + 1 &&
                console.bottom <= innerHeight
              );
            }),
          )
          .toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: `artifacts/modern-ui-${theme}-${language}.png`,
        animations: "disabled",
      });
    });
  }
}

test("layout storage unavailable does not prevent resizing or request editing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("storage unavailable");
    };
    Storage.prototype.getItem = () => {
      throw new Error("storage unavailable");
    };
  });
  await openWorkspace(page);
  await showSidebar(page);
  await page
    .getByRole("separator", { name: "Resize workspace panel" })
    .press("ArrowRight");
  await expect(page.locator("aside")).toHaveCSS("width", "276px");
  await page.getByLabel("Request URL").fill("https://example.test/edited");
  await expect(page.getByLabel("Request URL")).toHaveValue(
    "https://example.test/edited",
  );
});

test.describe("high DPI visual acceptance", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  test("Retina layout shows resources, response and diagnostic details", async ({
    page,
  }) => {
    await openWorkspace(page, { theme: "dark" });
    await showSidebar(page);
    await page.getByRole("button", { name: "Params", exact: true }).click();
    await page.getByRole("button", { name: "Send ↗", exact: true }).click();
    await openMore(page);
    await page.getByRole("button", { name: "Console", exact: false }).click();
    await page
      .getByRole("separator", { name: "Resize console", exact: true })
      .press("ArrowUp");
    await page.locator(".console-entry summary").click();
    await expect(page.locator(".console-general")).toBeVisible();
    await expect(page.locator(".app")).toHaveCount(1);
    await expect(page.locator(".app-header")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Send ↗", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: "artifacts/modern-ui-retina.png",
      animations: "disabled",
    });
  });
});

test("empty and malformed JSON responses keep the original data and show clear feedback", async ({
  page,
}) => {
  let sent = 0;
  await openWorkspace(page, {
    send: async () => ({
      ...response,
      body: ++sent === 1 ? "" : "{broken",
      size: sent === 1 ? 0 : 7,
    }),
  });
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(
    page.getByText("Empty response body", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(
    page.getByText("Invalid JSON; showing the original response.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".response .cm-content")).toContainText("{broken");
});

test("HTTP methods are selected from a menu and custom methods require explicit confirmation", async ({
  page,
}) => {
  await openWorkspace(page);
  const method = page.getByRole("combobox", {
    name: "HTTP method",
    exact: true,
  });
  await method.selectOption("POST");
  await expect(method).toHaveValue("POST");
  await method.selectOption("DELETE");
  await expect(method).toHaveValue("DELETE");
  await method.selectOption("custom");
  const custom = page.getByLabel("Custom HTTP method", { exact: true });
  await custom.fill("NOT A TOKEN");
  await page.getByRole("button", { name: "Apply method", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("valid HTTP method");
  await custom.fill("PROPFIND");
  await page.getByRole("button", { name: "Apply method", exact: true }).click();
  await expect(method.locator("option:checked")).toHaveText("PROPFIND");
  await expect(custom).toBeHidden();
});

test("temporary requests send without entering a collection and save only to an explicit destination", async ({
  page,
}) => {
  const backend = await openWorkspace(page, {
    configure: (w) => {
      w.collections.push({
        ...w.collections[0],
        id: "other",
        name: "Other API",
      });
    },
  });
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.getByLabel("Request name").fill("Temporary test");
  await page.getByLabel("Request URL").fill("https://example.test/temporary");
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect(page.locator(".metrics b")).toHaveText(
    "500 Internal Server Error",
  );
  expect(backend.read().items).toHaveLength(1);
  await expect(page.locator(".request-location")).toHaveText(
    "Temporary request",
  );
  await page
    .getByRole("button", { name: /^Save (?:⌘S|Ctrl\+S)$/, exact: true })
    .click();
  await expect(page.getByLabel("Save location")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Save request", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Save location").selectOption("c:other");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(page.locator(".request-location")).toHaveText("Other API");
  expect(
    backend.read().items.find((item) => item.name === "Temporary test")
      ?.collectionId,
  ).toBe("other");
});

test("adding within a folder fixes the destination at creation even after resource selection changes", async ({
  page,
}) => {
  const backend = await openWorkspace(page, {
    configure: (w) => {
      w.items.push({
        id: "folder",
        collectionId: "collection",
        parentId: null,
        kind: "folder",
        name: "Child folder",
        order: 1,
        auth: { type: "inherit" },
        request: null,
        metadata: null,
      });
      w.collections.push({
        ...w.collections[0],
        id: "other",
        name: "Other API",
      });
    },
  });
  await showSidebar(page);
  await page
    .getByRole("button", { name: "Add request to Child folder", exact: true })
    .click();
  await expect(page.locator(".request-location")).toHaveText(
    "API / Child folder",
  );
  await page.getByLabel("Request name").fill("Scoped request");
  await page
    .getByRole("button", { name: "Edit collection Other API", exact: true })
    .click();
  await page.getByRole("button", { name: "Close ×", exact: true }).click();
  await page
    .getByRole("button", { name: /^Save (?:⌘S|Ctrl\+S)$/, exact: true })
    .click();
  await expect
    .poll(
      () =>
        backend.read().items.find((item) => item.name === "Scoped request")
          ?.parentId,
    )
    .toBe("folder");
  expect(
    backend.read().items.find((item) => item.name === "Scoped request")
      ?.collectionId,
  ).toBe("collection");
});

test("request identity, new request, search and Console belong to their visible scopes", async ({
  page,
}) => {
  await openWorkspace(page, { openSavedRequest: false });
  await expect(
    page
      .locator(".app-header")
      .getByRole("button", { name: "Search requests" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".app-header").getByRole("button", { name: "New request" }),
  ).toHaveCount(0);
  await expect(page.locator(".app-header").getByRole("textbox")).toHaveCount(0);
  await expect(
    page
      .locator(".request-tabs")
      .getByRole("button", { name: "New request", exact: true }),
  ).toBeInViewport();
  await expect(
    page.locator(".request-identity").getByLabel("Request name"),
  ).toBeVisible();
  await expect(page.locator("aside .search")).toBeVisible();
  await page.locator("aside .search").fill("not found");
  await expect(
    page.getByText("No matching requests.", { exact: true }),
  ).toBeVisible();
  await page.locator("aside .search").fill("");
  await page
    .locator(".workspace-status")
    .getByRole("button", { name: "Console", exact: true })
    .click();
  await expect(page.locator(".console")).toBeVisible();
});

test("request tab switching restores configuration and synchronizes the resource highlight", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Params", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: "Request tab: Users", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Body", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await showSidebar(page);
  await expect(page.locator(".tree-row.selected")).toHaveText("GETUsers");
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await expect(page.locator(".editor-content")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`${theme}: Console is compact and all dividers stay thin with usable drag targets`, async ({
    page,
  }) => {
    await openWorkspace(page, { theme });
    await showSidebar(page);
    await page.getByRole("button", { name: "Send ↗", exact: true }).click();
    await openMore(page);
    await page.getByRole("button", { name: "Console", exact: false }).click();
    const console = page.locator(".console");
    await expect(console.locator(".console-toolbar button")).toHaveCount(2);
    await expect(
      console.locator("input, select, .console-column-heading"),
    ).toHaveCount(0);
    expect(
      (await console.locator(".console-toolbar").boundingBox())!.height,
    ).toBeLessThanOrEqual(38);
    for (const name of [
      "Resize workspace panel",
      "Resize request and response",
      "Resize console",
    ]) {
      const split = page.getByRole("separator", { name, exact: true });
      const vertical = name === "Resize workspace panel";
      await expect(split).toHaveCSS(vertical ? "width" : "height", "1px");
      const box = (await split.boundingBox())!;
      const before = Number(await split.getAttribute("aria-valuenow"));
      // Start outside the visible 1px line, inside its transparent hit area.
      const x = vertical ? box.x + 3 : box.x + box.width / 2;
      const y = vertical ? box.y + 100 : box.y + 3;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (vertical ? 24 : 0), y + (vertical ? 0 : 20));
      await page.mouse.up();
      expect(Number(await split.getAttribute("aria-valuenow"))).not.toBe(
        before,
      );
    }
    const row = console.locator("summary").first();
    await row.focus();
    await row.press("Enter");
    await expect(console.locator(".console-details")).toBeVisible();
    await expect(console.locator(".console-details")).toContainText(
      "current-response",
    );
    await page.screenshot({ path: `artifacts/console-compact-${theme}.png` });
    await console.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(console.locator(".console-entry")).toHaveCount(0);
    await expect(
      console.getByRole("button", { name: "Clear", exact: true }),
    ).toBeDisabled();
  });
}

for (const language of ["en-US", "zh-CN"]) {
  test(`${language}: Settings shows the canonical application version`, async ({
    page,
  }) => {
    await openWorkspace(page, {
      openSavedRequest: false,
      configure: (workspace) => {
        workspace.settings.language = language;
      },
    });
    await page
      .getByRole("button", {
        name: language === "zh-CN" ? "⚙ 设置" : "⚙ Settings",
        exact: true,
      })
      .click();
    const description = page.getByText(`Local Postman ${appVersion} ·`, {
      exact: false,
    });
    await expect(description).toBeVisible();
    await expect(description).toContainText(
      language === "zh-CN" ? "SQLite 本地存储" : "Local SQLite storage",
    );
    await expect(
      page.getByText("Local Postman 0.5.0 ·", { exact: false }),
    ).toHaveCount(0);
  });
}

function nestUsers(workspace: Workspace) {
  workspace.items[0].parentId = "folder";
  workspace.items.push({
    id: "folder",
    name: "Users folder",
    collectionId: "collection",
    parentId: null,
    kind: "folder",
    order: 0,
    auth: { type: "inherit" },
    request: null,
    metadata: null,
  });
}

for (const theme of ["light", "dark"]) {
  test(`${theme}: collection branches have a single disclosure and quiet, keyboard-accessible actions`, async ({
    page,
  }) => {
    await openWorkspace(page, { theme, configure: nestUsers });
    await showSidebar(page);
    for (const name of ["API", "Users folder"]) {
      const label = page.getByRole("button", { name, exact: true });
      const row = page.locator(".tree-row").filter({ has: label });
      await expect(label.locator("svg")).toHaveCount(
        name === "Users folder" ? 1 : 0,
      );
      await expect(row.locator(".collapse")).toHaveCount(1);
      await expect(row.locator(".collapse svg")).toHaveCount(1);
      expect(await row.innerText()).not.toMatch(/[▣▾▸]/);
      const toggle = row.locator(".collapse");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByRole("button", { name: "GET Users", exact: true }),
      ).toBeHidden();
      await toggle.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByRole("button", { name: "GET Users", exact: true }),
      ).toBeVisible();
    }
    await expect(page.locator(".panel")).toHaveCount(0);
    const request = page.getByRole("button", {
      name: "GET Users",
      exact: true,
    });
    await expect(request.locator(".method")).toHaveText("GET");
    await expect(request).toHaveAttribute("aria-current", "true");
    const add = page.getByRole("button", {
      name: "Add request to API",
      exact: true,
    });
    await page.getByLabel("Request URL", { exact: true }).focus();
    await page.mouse.move(700, 400);
    await expect(add).toHaveCSS("opacity", "0");
    await add.focus();
    await expect(add).toHaveCSS("opacity", "1");
    await page.getByLabel("Request URL", { exact: true }).focus();
    await page.locator(".collection").hover();
    await expect(add).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `artifacts/tree-disclosures-${theme}.png` });
    await page
      .getByRole("button", { name: "Edit collection API", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Collection", exact: true }),
    ).toBeVisible();
  });
}

test("search disclosure state matches visible children and preserves the saved browsing layout", async ({
  page,
}) => {
  await openWorkspace(page, { configure: nestUsers });
  await showSidebar(page);
  await page.getByRole("button", { name: "Collapse API", exact: true }).click();
  const search = page.getByPlaceholder(/^Search name or URL\s+(?:⌘K|Ctrl\+K)$/);
  await search.fill("users");
  await expect(
    page.getByRole("button", { name: "Collapse API", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  const folder = page.getByRole("button", {
    name: "Collapse Users folder",
    exact: true,
  });
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeVisible();
  await folder.click();
  await expect(
    page.getByRole("button", { name: "Expand Users folder", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeHidden();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("localpm-tree-collapsed")!),
    ),
  ).toEqual(["collection"]);
  await search.fill("");
  await expect(
    page.getByRole("button", { name: "Expand API", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand API", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeVisible();
});

test("adding a request expands the folder and persists that expansion after reload", async ({
  page,
}) => {
  await openWorkspace(page, { configure: nestUsers });
  await showSidebar(page);
  await page
    .getByRole("button", { name: "Collapse Users folder", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add request to Users folder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Collapse Users folder", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("localpm-tree-collapsed")!),
    ),
  ).not.toContain("folder");
  await page.reload();
  await showSidebar(page);
  await expect(
    page.getByRole("button", { name: "Collapse Users folder", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeVisible();
});

test("branch text, trailing label space and row padding toggle without opening settings", async ({
  page,
}) => {
  await openWorkspace(page, { configure: nestUsers });
  await showSidebar(page);
  const users = page.getByRole("button", { name: "GET Users", exact: true });
  for (const name of ["API", "Users folder"]) {
    const label = page.getByRole("button", { name, exact: true });
    await label.locator("span").click();
    await expect(label).toHaveAttribute("aria-expanded", "false");
    await expect(users).toBeHidden();
    await expect(page.locator(".panel")).toHaveCount(0);
    const box = (await label.boundingBox())!;
    await label.click({ position: { x: box.width - 3, y: box.height / 2 } });
    await expect(label).toHaveAttribute("aria-expanded", "true");
    await expect(users).toBeVisible();
    const row = page.locator(".tree-row").filter({ has: label });
    await row.click({ position: { x: 2, y: 18 } });
    await expect(label).toHaveAttribute("aria-expanded", "false");
    await label.press("Space");
    await expect(label).toHaveAttribute("aria-expanded", "true");
  }
  const folder = page.getByRole("button", {
    name: "Users folder",
    exact: true,
  });
  await folder.press("Enter");
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await page
    .getByRole("button", { name: "Edit folder Users folder", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Folder", exact: true }),
  ).toBeVisible();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".panel")).toHaveCount(0);
  await folder.click();
  await page.reload();
  await showSidebar(page);
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await folder.click();
  await expect(users).toBeVisible();
  await users.click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    "https://example.test/users?page=1",
  );
  await expect(page.locator(".panel")).toHaveCount(0);
});

test("text toggling in search preserves the normal collection layout", async ({
  page,
}) => {
  await openWorkspace(page, { configure: nestUsers });
  await showSidebar(page);
  const collection = page.getByRole("button", { name: "API", exact: true });
  await collection.click();
  const search = page.getByPlaceholder(/^Search name or URL\s+(?:⌘K|Ctrl\+K)$/);
  await search.fill("Users");
  await expect(collection).toHaveAttribute("aria-expanded", "true");
  const folder = page.getByRole("button", {
    name: "Users folder",
    exact: true,
  });
  await folder.click();
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Expand Users folder", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await folder.click();
  await expect(
    page.getByRole("button", { name: "GET Users", exact: true }),
  ).toBeVisible();
  await search.clear();
  await expect(collection).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".panel")).toHaveCount(0);
});

test("Send executes current edits while only explicit Save updates the collection", async ({
  page,
}) => {
  let saves = 0;
  let sent: RequestSpec | undefined;
  let sentContext: Workspace | undefined;
  const backend = await openWorkspace(page, {
    save: async () => {
      saves++;
    },
    send: async ({ request, workspace }) => {
      sent = structuredClone(request);
      sentContext = structuredClone(workspace);
      return response;
    },
  });
  const url = "https://example.test/draft-only";
  await page.getByLabel("Request name", { exact: true }).fill("Modified users");
  await page.getByLabel("Request URL", { exact: true }).fill(url);
  await page.getByRole("button", { name: "Scripts", exact: true }).click();
  const script = 'pm.environment.set("fromDraft", "value");';
  await page
    .getByRole("textbox", { name: "Post-response script editor", exact: true })
    .fill(script);
  await page
    .getByRole("checkbox", { name: "Run this request's scripts" })
    .check();
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect.poll(() => sent?.url).toBe(url);
  expect(sent?.name).toBe("Modified users");
  expect(sent?.metadata.localpmScripts.postResponse).toBe(script);
  expect(sentContext?.items[0].request?.name).toBe("Users");
  await page.waitForTimeout(2300); // Sending must not hide a later collection autosave.
  expect(saves).toBe(0);
  expect(backend.read().items[0].request?.name).toBe("Users");
  expect(backend.read().items[0].request?.metadata).toBeNull();
  expect(backend.drafts.get("request")?.url).toBe(url);
  await expect(page.locator(".save-status")).toHaveText("Unsaved changes");
  await expect(
    page.getByRole("button", {
      name: "Request tab: Modified users",
      exact: true,
    }),
  ).toHaveAccessibleDescription("Unsaved changes");
  await page.reload();
  await showSidebar(page);
  await page.getByRole("button", { name: "GET Users", exact: true }).click();
  await expect(page.getByLabel("Request URL", { exact: true })).toHaveValue(
    url,
  );
  await expect(page.locator(".save-status")).toHaveText("Unsaved changes");
  await saveRequest(page);
  expect(saves).toBe(1);
  expect(backend.read().items[0].request?.url).toBe(url);
  expect(
    backend.read().items[0].request?.metadata.localpmScripts.postResponse,
  ).toBe(script);
  expect(backend.drafts.has("request")).toBe(false);
  await expect(page.locator(".save-status")).toHaveText("Saved to API");
});

test("sending an unchanged saved request does not create a draft or save the workspace", async ({
  page,
}) => {
  let saves = 0;
  let sends = 0;
  const backend = await openWorkspace(page, {
    save: async () => {
      saves++;
    },
    send: async () => {
      sends++;
      return response;
    },
  });
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect.poll(() => sends).toBe(1);
  expect(saves).toBe(0);
  expect(backend.draftWrites).toEqual([]);
  await expect(page.locator(".save-status")).toHaveText("Saved to API");
});

test("parameter tables offer a virtual blank row and preserve bulk-pasted data without storing the placeholder", async ({
  page,
}) => {
  const backend = await openWorkspace(page);
  await page.getByRole("button", { name: "Params", exact: true }).click();
  await expect(page.getByLabel("Key 2", { exact: true })).toBeVisible();
  await page.getByLabel("Key 2", { exact: true }).fill("limit");
  await page.getByLabel("Value 2", { exact: true }).fill("20");
  await expect(page.getByLabel("Key 3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Request URL")).toHaveValue(
    "https://example.test/users?page=1&limit=20",
  );
  await saveRequest(page);
  await expect
    .poll(() => backend.read().items[0].request!.params.length)
    .toBe(2);
  await page.getByLabel("Key 3", { exact: true }).evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      "text/plain",
      "tag=one\ntag=two\nempty=\ntoken={{token}}",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByLabel("Key 7", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Request URL")).toHaveValue(
    "https://example.test/users?page=1&limit=20&tag=one&tag=two&empty=&token={{token}}",
  );
  await saveRequest(page);
  await expect
    .poll(() => backend.read().items[0].request!.params.length)
    .toBe(6);
  expect(
    backend
      .read()
      .items[0].request!.params.filter((row) => row.key === "tag")
      .map((row) => row.value),
  ).toEqual(["one", "two"]);
});

test("bulk header paste inserts rows without overwriting following headers or changing disabled flags", async ({
  page,
}) => {
  const backend = await openWorkspace(page, {
    configure: (workspace) => {
      workspace.items[0].request!.headers = [
        { key: "Old", value: "old", description: "Keep note", enabled: false },
        { key: "Existing", value: "keep", description: "", enabled: true },
      ];
    },
  });
  await page.getByRole("button", { name: "Headers", exact: true }).click();
  await page.getByLabel("Key 1", { exact: true }).evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      "text/plain",
      "X-Time: 12:30\r\nX-Empty:\r\nX-Tag: a\r\nX-Tag: b",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByLabel("Key 5", { exact: true })).toHaveValue(
    "Existing",
  );
  await expect(page.getByLabel("Value 5", { exact: true })).toHaveValue("keep");
  await expect(
    page.getByLabel("Enable row 1", { exact: true }),
  ).not.toBeChecked();
  await saveRequest(page);
  await expect
    .poll(() => backend.read().items[0].request!.headers.length)
    .toBe(5);
  expect(backend.read().items[0].request!.headers[0]).toMatchObject({
    key: "X-Time",
    value: "12:30",
    description: "Keep note",
    enabled: false,
  });
});

test("copy feedback clears automatically, restarts on repeated copy and never shows a success toast on failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if ((window as any).__failCopy) throw new Error("Clipboard denied");
          (window as any).__clipboardText = text;
        },
      },
    });
  });
  await openWorkspace(page);
  await page.clock.install();
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  const copy = page.getByRole("button", { name: "Copy response", exact: true });
  await copy.click();
  await expect(page.locator(".response-tools .copy-feedback")).toHaveText(
    "Copied",
  );
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.clock.fastForward(1000);
  await copy.click();
  await page.clock.fastForward(1000);
  await expect(page.locator(".response-tools .copy-feedback")).toHaveText(
    "Copied",
  );
  await page.clock.fastForward(700);
  await expect(page.locator(".response-tools .copy-feedback")).toHaveCount(0);
  await openMore(page);
  await page.getByRole("button", { name: "Copy cURL", exact: true }).click();
  await expect(page.locator(".request-tools .copy-feedback")).toHaveText(
    "cURL copied.",
  );
  await page.clock.fastForward(1700);
  await expect(page.locator(".request-tools .copy-feedback")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__failCopy = true;
  });
  await copy.click();
  await expect(page.getByRole("alert")).toContainText(
    "Unable to copy to the clipboard.",
  );
  await expect(page.locator(".response-tools .copy-feedback")).toHaveCount(0);
});

test("Windows and Linux use Ctrl shortcut hints in both languages", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    }),
  );
  await openWorkspace(page, { openSavedRequest: false });
  await expect(
    page.getByRole("button", { name: "Save Ctrl+S", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Search name or URL  Ctrl+K"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Console", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "⚙ Settings", exact: true }).click();
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await page.getByRole("button", { name: "关闭 ×", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存 Ctrl+S", exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("搜索名称或 URL  Ctrl+K")).toBeVisible();
});

test("form-data preserves disabled fields and file paths while editing and sending", async ({
  page,
}) => {
  let sent: RequestSpec | undefined;
  await openWorkspace(page, {
    configure: (workspace) => {
      workspace.items[0].request!.body = {
        mode: "formdata",
        formdata: [
          {
            key: "title",
            value: "original",
            type: "text",
            disabled: true,
            description: "Keep metadata",
          },
          {
            key: "upload",
            type: "file",
            src: "/tmp/reports/very-long-report-name.json",
          },
        ],
      };
    },
    send: async ({ request }) => {
      sent = request;
      return response;
    },
  });
  await page.getByRole("button", { name: "Body", exact: true }).click();
  const table = page.locator(".kv-formdata");
  await expect(table.locator(".kv-row")).toHaveCount(3);
  await expect(
    table.getByLabel("Enable row 1", { exact: true }),
  ).not.toBeChecked();
  await table.getByLabel("Value 1", { exact: true }).fill("updated");
  await expect(table.getByLabel("Choose file 2", { exact: true })).toHaveText(
    "very-long-report-name.json",
  );
  await expect(
    table.getByLabel("Choose file 2", { exact: true }),
  ).toHaveAttribute("title", "/tmp/reports/very-long-report-name.json");
  await table.getByLabel("Field type 2", { exact: true }).selectOption("text");
  await table.getByLabel("Field type 2", { exact: true }).selectOption("file");
  await page.getByRole("button", { name: "Send ↗", exact: true }).click();
  await expect.poll(() => sent?.body.formdata.length).toBe(2);
  expect(sent!.body.formdata[0]).toMatchObject({
    value: "updated",
    disabled: true,
    description: "Keep metadata",
  });
  expect(sent!.body.formdata[1].src).toBe(
    "/tmp/reports/very-long-report-name.json",
  );
  await table.getByLabel("Key 3", { exact: true }).fill("extra");
  await expect(table.locator(".kv-row")).toHaveCount(4);
  await table
    .getByRole("button", { name: "Remove row", exact: true })
    .nth(2)
    .click();
  await expect(table.locator(".kv-row")).toHaveCount(3);
});

test("failed assertions reopen script results and a successful retry collapses them", async ({
  page,
}) => {
  let calls = 0;
  await openWorkspace(page, {
    send: async () => ({
      ...response,
      scripts: {
        tests: [
          {
            name: "expected token",
            passed: ++calls === 3,
            error: calls === 3 ? undefined : "Token missing",
          },
        ],
      },
    }),
  });
  const send = page.getByRole("button", { name: "Send ↗", exact: true });
  const results = page.locator(".script-results");
  await send.click();
  await expect(results).toHaveAttribute("open", "");
  await expect(
    results.getByText("Token missing", { exact: false }),
  ).toBeVisible();
  await results.locator("summary").click();
  await expect(results).not.toHaveAttribute("open");
  await send.click();
  await expect(results).toHaveAttribute("open", "");
  await send.click();
  await expect(results).not.toHaveAttribute("open");
  await expect(results).toHaveAttribute("data-failed", "false");
});
