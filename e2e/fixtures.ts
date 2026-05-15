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
    cacheStatus: "fresh",
    description: "Tightens the cached review inbox behavior.",
    labels: ["review", "runtime"],
    commitsCount: 2,
    commentsCount: 3,
    tasksCount: 2,
    additionsCount: 40,
    deletionsCount: 8,
    approvals: { received: 1, required: 1 },
    requestedReviewers: ["lane"],
    changedFileGroups: [
      {
        label: "ui",
        files: [{ path: "ui/app/useReviewInbox.ts", additions: 24, deletions: 4 }],
      },
      {
        label: "desktop",
        files: [{ path: "desktop/src/runtime/scm.rs", additions: 16, deletions: 4 }],
      },
    ],
    activity: [{ actor: "reviewer", detail: "updated this pull request", age: "today" }],
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
    cacheStatus: "fresh",
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
    hydrate_review_inbox_row: (args: unknown) => {
      const request = typeof args === "object" && args !== null ? (args as { request?: unknown }).request : undefined;
      const repo = typeof request === "object" && request !== null
        ? (request as { repo?: unknown }).repo
        : undefined;
      const pullRequest = typeof request === "object" && request !== null
        ? (request as { pullRequest?: unknown }).pullRequest
        : undefined;
      const row = mockInboxRows.find(
        (candidate) =>
          candidate.repoId === repo &&
          String(candidate.number ?? candidate.id) === String(pullRequest),
      );
      if (!row) return { row };
      return {
        row: {
          ...row,
          cacheStatus: "fresh",
          description: row.description ?? `${row.title} has hydrated provider detail.`,
          commitsCount: row.commitsCount ?? 2,
          commentsCount: row.commentsCount ?? 1,
          tasksCount: row.tasksCount ?? 2,
          additionsCount: row.additionsCount ?? 18,
          deletionsCount: row.deletionsCount ?? 3,
          checks: row.checks ?? { passing: 1, failing: 0, pending: 0 },
          approvals: row.approvals ?? { received: 1, required: 1 },
          requestedReviewers: row.requestedReviewers ?? ["lane"],
          changedFileGroups: row.changedFileGroups ?? [
            {
              label: "src",
              files: [{ path: "src/hydrated-provider-detail.ts", additions: 18, deletions: 3 }],
            },
          ],
          activity: row.activity ?? [
            { actor: row.author, detail: "updated this pull request", age: row.age },
          ],
        },
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
