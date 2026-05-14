import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*native.*\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 5_000,
  },
  projects: [
    {
      name: "tauri",
      use: {
        mode: "tauri",
      },
    },
  ],
});
