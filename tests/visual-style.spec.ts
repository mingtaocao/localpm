import { test, expect, type Page } from "@playwright/test";

async function openReview(page: Page, theme: string, language: string) {
  await page.addInitScript(
    ({ theme, language }) => {
      const requests = Array.from({ length: 9 }, (_, index) => ({
        id: `visual-${index}`,
        name:
          index === 0
            ? "获取用户详情 / User profile"
            : `订单查询与状态更新 ${index}`,
        method: index === 0 ? "GET" : "POST",
        url: `https://api.example.test/v1/users/${index}`,
        params: [],
        headers: [{ key: "Accept", value: "application/json", enabled: true }],
        auth: { type: "noauth" },
        body: {
          mode: "raw",
          raw: JSON.stringify(
            {
              userId: 1024,
              name: "明涛",
              options: { include: ["profile", "permissions"], active: true },
            },
            null,
            2,
          ),
          options: { raw: { language: "json" } },
        },
        settings: {},
        metadata: null,
      }));
      const workspace = {
        collections: [
          {
            id: "review",
            name: "工作空间 API",
            auth: { type: "noauth" },
            variables: [],
            metadata: null,
          },
        ],
        items: requests.map((request, index) => ({
          id: `item-${index}`,
          name: request.name,
          collectionId: "review",
          parentId: null,
          kind: "request",
          order: index,
          auth: { type: "inherit" },
          request,
          metadata: null,
        })),
        environments: [
          {
            id: "dev",
            name: "开发环境 / Development",
            variables: [],
            settings: {},
            metadata: null,
          },
        ],
        activeEnvironment: "dev",
        globals: [],
        settings: { theme, language },
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "app_bootstrap")
            return { workspace, drafts: requests, history: [] };
          if (command === "save_workspace")
            return Object.assign(workspace, args.workspace);
          if (command === "get_history" || command === "list_executions")
            return [];
          if (command === "send_request")
            return {
              status: 200,
              statusText: "OK",
              headers: [["Content-Type", "application/json"]],
              body: JSON.stringify(
                {
                  id: 1024,
                  name: "明涛",
                  email: "user@example.test",
                  roles: ["developer"],
                  active: true,
                },
                null,
                2,
              ),
              duration: 128,
              size: 132,
              contentType: "application/json",
              finalUrl: requests[0].url,
              redirects: [],
              file: "visual-response",
              binary: false,
              truncated: false,
            };
          return null;
        },
      };
    },
    { theme, language },
  );
  await page.goto("/");
  await expect(page.locator(".request-name")).toBeVisible();
  const show = page.getByRole("button", {
    name: /^(Show requests|展开请求列表)$/,
  });
  if (await show.count()) await show.click();
  await page.getByRole("button", { name: /^(Body|请求体)$/ }).click();
  await page.locator(".url-bar .primary").click();
  await expect(page.locator(".response .cm-content")).toContainText("明涛");
}

function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        const value = v / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

for (const theme of ["light", "dark"]) {
  for (const language of ["en-US", "zh-CN"]) {
    for (const width of [900, 1440]) {
      test(`${theme} ${language} ${width}: mixed-language content stays aligned and readable`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 900 ? 640 : 900,
        });
        await openReview(page, theme, language);
        const field = (await page.locator(".url-field").boundingBox())!;
        const send = (await page.locator(".url-bar .primary").boundingBox())!;
        expect(Math.abs(field.y - send.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(field.height - send.height)).toBeLessThanOrEqual(1);
        for (const selector of [
          ".url-bar .primary",
          ".request-name",
          ".request-identity > button",
          ".response-heading",
          ".configuration-navigation",
        ]) {
          const box = (await page.locator(selector).boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          expect(box.height).toBeGreaterThan(0);
        }
        const view = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            text: root.getPropertyValue("--text").trim(),
            muted: root.getPropertyValue("--muted").trim(),
            surface: getComputedStyle(document.querySelector(".response")!)
              .backgroundColor,
            textColor: getComputedStyle(
              document.querySelector(".request-name")!,
            ).color,
            mutedColor: getComputedStyle(
              document.querySelector(".metrics span")!,
            ).color,
          };
        });
        expect(view.overflow).toBeLessThanOrEqual(1);
        expect(contrast(view.textColor, view.surface)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrast(view.mutedColor, view.surface)).toBeGreaterThanOrEqual(
          4.5,
        );
        await page.screenshot({
          path: `artifacts/style-review/${theme}-${language}-${width}.png`,
        });
      });
    }
  }
}
