import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1280, height: 850 },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run dev",
      url: "http://127.0.0.1:1420",
      reuseExistingServer: true,
    },
    {
      command: "node scripts/mock-server.mjs",
      url: "http://127.0.0.1:47831/echo",
      reuseExistingServer: true,
    },
  ],
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/ui-test-results.json" }],
  ],
});
