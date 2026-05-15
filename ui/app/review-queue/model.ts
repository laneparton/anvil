import type {
  ReviewInboxFilter,
  ReviewInboxPullRequest,
  ReviewInboxSourceFilter,
} from "@/app/LauncherScreen";

import type { QueueGroupDefinition, QueuePullRequest, QueueState } from "./types";

export const queueGroups: QueueGroupDefinition[] = [
  {
    id: "needs-review",
    label: "Recommended next",
    description: "Open PRs where your review is currently requested or useful.",
  },
  {
    id: "created-by-me",
    label: "Created by me",
    description: "Open pull requests you authored.",
  },
  {
    id: "assigned-to-me",
    label: "Assigned to me",
    description: "Explicit review requests and assignments.",
  },
  {
    id: "all-open",
    label: "All open",
    description: "Every open pull request returned by connected providers.",
  },
];

export function normalizeQueuePullRequest(pullRequest: ReviewInboxPullRequest): QueuePullRequest {
  const provider = providerName(pullRequest.provider ?? pullRequest.source);
  const source = sourceId(pullRequest.source ?? pullRequest.provider);
  const number = String(pullRequest.number ?? pullRequest.pullRequestId ?? pullRequest.id);
  const changedFilesCount =
    pullRequest.files === null || pullRequest.files === undefined ? undefined : Number(pullRequest.files);

  return {
    id: pullRequest.id,
    raw: pullRequest,
    provider,
    providerSource: pullRequest.provider ?? sourceName(source),
    source,
    repo: pullRequest.repo,
    repoName: pullRequest.repoName ?? pullRequest.repo,
    number,
    author: pullRequest.author,
    age: pullRequest.age,
    title: pullRequest.title,
    changedFilesCount: Number.isFinite(changedFilesCount) ? changedFilesCount : undefined,
    status: pullRequest.status || "open",
    url: pullRequest.url,
    sourceBranch: pullRequest.headRefName,
    targetBranch: pullRequest.baseRefName,
    needsReview:
      pullRequest.needsReview ?? (pullRequest.reviewStatus ? pullRequest.reviewStatus === "needsReview" : true),
    isCreatedByMe: Boolean(pullRequest.isCreatedByMe || pullRequest.reviewStatus === "createdByMe"),
    isAssignedToMe: Boolean(pullRequest.isAssignedToMe || pullRequest.reviewStatus === "assignedToMe"),
  };
}

export function queueRowInGroup(row: QueuePullRequest, group: QueueState) {
  if (group === "all-open") return true;
  if (group === "created-by-me") return row.isCreatedByMe;
  if (group === "assigned-to-me") return row.isAssignedToMe;
  return row.needsReview;
}

export function filterForGroup(group: QueueState): ReviewInboxFilter {
  if (group === "created-by-me") return "createdByMe";
  if (group === "assigned-to-me") return "assignedToMe";
  if (group === "all-open") return "allOpen";
  return "needsReview";
}

export function matchesSource(row: QueuePullRequest, sourceFilter: ReviewInboxSourceFilter) {
  return sourceFilter === "all" || row.source === sourceFilter;
}

export function countSources(rows: QueuePullRequest[]) {
  return {
    github: rows.filter((row) => row.source === "github").length,
    bitbucket: rows.filter((row) => row.source === "bitbucket").length,
  };
}

export function sourceId(source: unknown) {
  const value = String(source ?? "").toLowerCase();
  if (value.includes("bitbucket")) return "bitbucket";
  if (value.includes("github")) return "github";
  return "unknown";
}

export function sourceName(source: unknown) {
  const normalized = sourceId(source);
  if (normalized === "bitbucket") return "Bitbucket";
  if (normalized === "github") return "GitHub";
  return "Unknown";
}

function providerName(source: unknown): QueuePullRequest["provider"] {
  const name = sourceName(source);
  return name === "GitHub" || name === "Bitbucket" ? name : "Unknown";
}
