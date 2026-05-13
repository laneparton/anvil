import type { ReviewPlan, Slice } from "@/lib/review-types";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ReviewRepo = {
  id: string;
  name: string;
  provider: "GitHub" | "Bitbucket";
  openPrs: number | null;
  description?: string;
  updatedAt?: string;
};

export type ReviewPullRequest = {
  id: string;
  number?: string | number;
  title: string;
  repo: string;
  author: string;
  age: string;
  files: number | null;
  status: string;
  url?: string;
  headRefName?: string;
  baseRefName?: string;
  needsReview?: boolean;
  isCreatedByMe?: boolean;
  isAssignedToMe?: boolean;
};

export type ReviewInboxFilter = "needsReview" | "createdByMe" | "assignedToMe" | "allOpen";

export type ReviewInboxRequest = {
  filter?: ReviewInboxFilter;
  providers?: string[];
  repos?: string[];
  limit?: number;
};

export type ReviewInboxRow = {
  source: string;
  provider: string;
  repoId: string;
  repoName: string;
  id: string;
  number?: string | number;
  title: string;
  author: string;
  age: string;
  files: number | null;
  status: string;
  url?: string;
  headRefName?: string;
  baseRefName?: string;
  needsReview?: boolean;
  isCreatedByMe?: boolean;
  isAssignedToMe?: boolean;
};

export type ReviewInboxResult = {
  rows: ReviewInboxRow[];
  errors: Array<{
    provider?: string;
    message?: string;
  }>;
};

export type StartReviewSessionRequest = {
  sessionId: string;
  source: string;
  repo: string | undefined;
  pullRequest: string;
};

export type PrepareReviewArtifacts = {
  planPath: string;
  uiPath: string;
  worktree: string;
};

export type PrepareReviewResult = {
  plan: ReviewPlan;
  artifacts?: PrepareReviewArtifacts;
};

export type ReviewSessionReadyData = PrepareReviewResult;

export type ReviewSessionEvent = {
  type: string;
  message: string;
  at: string | number;
  data?: unknown;
  [key: string]: unknown;
};

type ReviewSessionPayload = ReviewSessionEvent & {
  sessionId: string;
};

export type ReviewSessionHandlers = {
  onEvent: (event: ReviewSessionEvent) => void;
  onError?: (error: Error) => void;
};

export type ReviewSessionSubscription = {
  unsubscribe: () => void;
};

export type StartReviewSessionResult = {
  sessionId: string;
};

export type SubmitReviewSessionReceipt = {
  id?: string;
  receiptId?: string;
  status?: string;
  submittedAt?: string;
  commentCount?: number;
  action?: "approve" | "comment";
  [key: string]: unknown;
};

export type ReviewAgent = "codex" | "claude";

export type OpenReviewAgentRequest = {
  agent: ReviewAgent;
  worktree: string;
  repo?: string;
  pullRequest?: string | number;
  title?: string;
  slice?: Slice;
  terminalApp?: string;
  promptTemplate?: string;
  reviewSkillPath?: string;
};

export type OpenReviewAgentResult = {
  agent: ReviewAgent;
  worktree: string;
  prompt?: string;
  scriptPath?: string;
  terminalApp?: string;
};

export type AppSettingsBridge = {
  env: Record<string, string>;
};

export type QueuedReviewComment = {
  file: string;
  line: number | string;
  body: string;
  draft?: string;
  severity?: string;
};

export type SubmitReviewAction = "approve" | "comment";

export type SubmitReviewSessionRequest = {
  sessionId: string;
  source: string;
  repo: string;
  pullRequest: string;
  action: SubmitReviewAction;
  comments: QueuedReviewComment[];
};

export async function listGitHubRepos(): Promise<ReviewRepo[]> {
  const data = await tauriInvoke<{ repos: ReviewRepo[] }>("list_github_repos");
  return data.repos;
}

export async function listGitHubPullRequests(repo: string): Promise<ReviewPullRequest[]> {
  const data = await tauriInvoke<{ pulls: ReviewPullRequest[] }>("list_github_pull_requests", { repo });
  return data.pulls;
}

export async function listBitbucketRepos(): Promise<ReviewRepo[]> {
  const data = await tauriInvoke<{ repos: ReviewRepo[] }>("list_bitbucket_repos");
  return data.repos;
}

export async function listBitbucketPullRequests(repo: string): Promise<ReviewPullRequest[]> {
  const data = await tauriInvoke<{ pulls: ReviewPullRequest[] }>("list_bitbucket_pull_requests", { repo });
  return data.pulls;
}

export async function listReviewInbox(request: ReviewInboxRequest): Promise<ReviewInboxResult> {
  const data = await tauriInvoke<Partial<ReviewInboxResult> | undefined>("list_review_inbox", { request });
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    errors: Array.isArray(data?.errors) ? data.errors : [],
  };
}

export async function startReviewSession(
  request: StartReviewSessionRequest,
): Promise<StartReviewSessionResult> {
  try {
    return await tauriInvoke<StartReviewSessionResult>("start_review_session", { request });
  } catch (error) {
    throw toError(error);
  }
}

export async function subscribeReviewSession(
  sessionId: string,
  handlers: ReviewSessionHandlers,
): Promise<ReviewSessionSubscription> {
  let active = true;
  let unlisten: UnlistenFn;
  try {
    unlisten = await listen<ReviewSessionPayload>("review-session-event", (event) => {
      if (!active || event.payload.sessionId !== sessionId) {
        return;
      }

      try {
        handlers.onEvent(normalizeReviewSessionEvent(event.payload));
      } catch (error) {
        if (active) handlers.onError?.(toError(error));
      }
    });
  } catch (error) {
    throw toError(error);
  }

  return {
    unsubscribe: () => {
      active = false;
      unlisten();
    },
  };
}

export async function cancelReviewSession(sessionId: string): Promise<void> {
  await tauriInvoke("cancel_review_session", { sessionId });
}

export async function submitReviewSession(
  request: SubmitReviewSessionRequest,
): Promise<SubmitReviewSessionReceipt> {
  return tauriInvoke<SubmitReviewSessionReceipt>("submit_review_session", {
    request,
  });
}

export async function openReviewAgent(
  request: OpenReviewAgentRequest,
): Promise<OpenReviewAgentResult> {
  return tauriInvoke<OpenReviewAgentResult>("open_review_agent", { request });
}

export async function configureAppSettings(settings: AppSettingsBridge): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await tauriInvoke("configure_app_settings", { settings });
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Anvil must be opened through the Tauri desktop app for native commands to run.");
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toError(error);
  }
}

function isTauriRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };

  return Boolean(runtime.__TAURI_INTERNALS__ || runtime.__TAURI__);
}

function normalizeReviewSessionEvent(input: unknown): ReviewSessionEvent {
  if (typeof input !== "object" || input === null) {
    return {
      type: "session.message",
      message: String(input),
      at: new Date().toISOString(),
    };
  }

  const event = input as Record<string, unknown>;

  return {
    ...event,
    type: typeof event.type === "string" ? event.type : "session.event",
    message: typeof event.message === "string" ? event.message : "Review session event.",
    at:
      typeof event.at === "string" || typeof event.at === "number"
        ? event.at
        : typeof event.timestamp === "string"
          ? event.timestamp
          : new Date().toISOString(),
  };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error);
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") return new Error(serialized);
  } catch {
    // Fall through to the generic message.
  }

  return new Error("The Tauri runtime failed before returning an error message.");
}
