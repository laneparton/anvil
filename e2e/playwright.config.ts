import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  projects: [
    {
      name: "browser-only",
      use: {
        ...devices["Desktop Chrome"],
        mode: "browser",
      },
    },
    {
      name: "tauri",
      use: {
        mode: "tauri",
      },
    },
  ],
  webServer: {
    command: "npm run dev:frontend",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
