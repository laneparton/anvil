import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
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
