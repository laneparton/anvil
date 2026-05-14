import { createTauriTest } from "@srsholmes/tauri-playwright";

const settingsStore = {
  settings: null as unknown,
  configuredEnv: {} as Record<string, string>,
};

const mockInboxRows = [
  {
    source: "github",
    provider: "GitHub",
    repoId: "acme/example",
    repoName: "acme/example",
    id: "1",
    number: 1,
    title: "Tighten review inbox behavior",
    author: "reviewer",
    age: "today",
    files: 4,
    status: "ready",
    needsReview: true,
    isCreatedByMe: false,
    isAssignedToMe: false,
  },
  ...Array.from({ length: 30 }, (_, index) => ({
    source: "bitbucket",
    provider: "Bitbucket",
    repoId: "workspace/example",
    repoName: "workspace/example",
    id: String(index + 2),
    number: index + 2,
    title: `Bitbucket workspace smoke ${index + 1}`,
    author: "lane",
    age: "today",
    files: null,
    status: "open",
    needsReview: false,
    isCreatedByMe: true,
    isAssignedToMe: false,
  })),
];

export const { test, expect } = createTauriTest({
  devUrl: process.env.ANVIL_E2E_TAURI === "1" ? "" : "http://127.0.0.1:5173",
  tauriCommand: "npm run tauri -- dev",
  tauriCwd: process.cwd(),
  tauriFeatures: ["e2e-testing"],
  mcpSocket: "/tmp/tauri-playwright.sock",
  startTimeout: 120,
  ipcContext: {
    mockInboxRows,
    settingsStore,
  },
  ipcMocks: {
    configure_app_settings: (args: unknown) => {
      const settings = typeof args === "object" && args !== null ? (args as { settings?: unknown }).settings : undefined;
      const env = typeof settings === "object" && settings !== null ? (settings as { env?: unknown }).env : undefined;
      const nextEnv: Record<string, string> = {};
      if (typeof env === "object" && env !== null) {
        for (const [key, value] of Object.entries(env)) {
          const envKey = key.trim();
          const envValue = typeof value === "string" ? value.trim() : "";
          if (envKey && envValue) {
            nextEnv[envKey] = envValue;
          }
        }
      }
      settingsStore.configuredEnv = nextEnv;
      return null;
    },
    load_app_settings: () => settingsStore.settings,
    save_app_settings: (args: unknown) => {
      const payload = typeof args === "object" && args !== null ? (args as { payload?: unknown }).payload : undefined;
      settingsStore.settings = typeof payload === "object" && payload !== null
        ? (payload as { settings?: unknown }).settings ?? null
        : null;
      return null;
    },
    reset_app_settings: () => {
      settingsStore.settings = null;
      settingsStore.configuredEnv = {};
      return null;
    },
    list_review_inbox: (args: unknown) => {
      const request = typeof args === "object" && args !== null ? (args as { request?: unknown }).request : undefined;
      const providersValue = typeof request === "object" && request !== null ? (request as { providers?: unknown }).providers : undefined;
      const providers = Array.isArray(providersValue)
        ? providersValue.filter((provider): provider is string => typeof provider === "string")
        : [];
      return {
        rows: providers.length > 0
          ? mockInboxRows.filter((row) => providers.includes(row.source))
          : mockInboxRows,
        errors: [],
      };
    },
    start_review_session: (args: unknown) => {
      const request = typeof args === "object" && args !== null ? (args as { request?: unknown }).request : undefined;
      const sessionId = typeof request === "object" && request !== null
        ? (request as { sessionId?: unknown }).sessionId
        : undefined;
      return { sessionId: typeof sessionId === "string" ? sessionId : "review-e2e" };
    },
  },
});
