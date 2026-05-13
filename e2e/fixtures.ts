import { createTauriTest } from "@srsholmes/tauri-playwright";

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
  },
  ipcMocks: {
    configure_app_settings: () => null,
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
