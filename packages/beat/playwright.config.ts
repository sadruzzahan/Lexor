import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80",
    extraHTTPHeaders: { Accept: "application/json" },
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  // Grep pattern: run only tests tagged @api unless PLAYWRIGHT_FULL=1
  grep: process.env.PLAYWRIGHT_FULL === "1" ? undefined : /@api/,
});
