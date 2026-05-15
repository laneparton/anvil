import type {
  ReviewInboxFilter,
  ReviewInboxPullRequest,
  ReviewSourceId,
} from "@/app/LauncherScreen";
import type { ReviewInboxRow } from "@/lib/api";

export function reviewInboxRowToPullRequest(row: ReviewInboxRow): ReviewInboxPullRequest {
  const needsReview = Boolean(row.needsReview);
  const isCreatedByMe = Boolean(row.isCreatedByMe);
  const isAssignedToMe = Boolean(row.isAssignedToMe);

  return {
    id: reviewInboxRowKey(row),
    pullRequestId: row.id,
    number: row.number ?? row.id,
    title: row.title,
    repo: row.repoId,
    repoId: row.repoId,
    repoName: row.repoName,
    provider: row.provider,
    source: row.source,
    author: row.author,
    age: row.age,
    files: row.files,
    status: row.status,
    url: row.url,
    headRefName: row.headRefName,
    baseRefName: row.baseRefName,
    reviewStatus: needsReview
      ? "needsReview"
      : isCreatedByMe
        ? "createdByMe"
        : isAssignedToMe
          ? "assignedToMe"
          : undefined,
    needsReview,
    isCreatedByMe,
    isAssignedToMe,
    cacheStatus: row.cacheStatus,
    cachedAt: row.cachedAt,
    description: row.description,
    labels: row.labels,
    commitsCount: row.commitsCount,
    commentsCount: row.commentsCount,
    tasksCount: row.tasksCount,
    additionsCount: row.additionsCount,
    deletionsCount: row.deletionsCount,
    checks: row.checks,
    approvals: row.approvals,
    requestedReviewers: row.requestedReviewers,
    changedFileGroups: row.changedFileGroups,
    activity: row.activity,
  };
}

export function reviewInboxRowKey(row: ReviewInboxRow): string {
  return [row.source, row.repoId, row.number ?? row.id].join(":");
}

export function getReviewPullRequestNumber(row: ReviewInboxPullRequest | undefined): string | undefined {
  if (!row) return undefined;
  return String(row.number ?? row.pullRequestId ?? row.id);
}

export function normalizeReviewSource(source: unknown): ReviewSourceId | undefined {
  const value = String(source ?? "").toLowerCase();
  if (value.includes("bitbucket")) return "bitbucket";
  if (value.includes("github")) return "github";
  return undefined;
}

export function formatInboxErrors(errors: Array<{ provider?: string; message?: string }> | undefined): string | undefined {
  const messages = (errors ?? []).flatMap((error) => {
    const message = [error.provider, error.message].filter(Boolean).join(": ");
    return message ? [message] : [];
  });

  return messages.length > 0 ? messages.join(" ") : undefined;
}

export function mergeReviewInboxRows(
  current: ReviewInboxPullRequest[],
  nextRows: ReviewInboxPullRequest[],
): ReviewInboxPullRequest[] {
  const rowsById = new Map<string, ReviewInboxPullRequest>();
  for (const row of [...current, ...nextRows]) {
    rowsById.set(row.id, row);
  }

  return Array.from(rowsById.values());
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);

    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

export function sourceLabel(provider: string): string {
  return provider === "bitbucket" ? "Bitbucket" : provider === "github" ? "GitHub" : provider;
}

export function providerTimeoutMs(provider: string): number {
  return provider === "github" ? 25_000 : 15_000;
}

export function matchesReviewInboxFilter(
  row: ReviewInboxPullRequest,
  filter: ReviewInboxFilter,
): boolean {
  if (filter === "allOpen") return true;
  return row.reviewStatus === filter;
}
