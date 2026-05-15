import type { ReviewInboxFilter, ReviewInboxPullRequest, ReviewInboxSourceFilter } from "@/app/LauncherScreen";

export type QueueState = "needs-review" | "created-by-me" | "assigned-to-me" | "all-open";

export type QueuePullRequest = {
  id: string;
  raw: ReviewInboxPullRequest;
  provider: "GitHub" | "Bitbucket" | "Unknown";
  providerSource: string;
  source: string;
  repo: string;
  repoName: string;
  number: string;
  author: string;
  age: string;
  title: string;
  changedFilesCount?: number;
  status: string;
  url?: string;
  sourceBranch?: string;
  targetBranch?: string;
  needsReview: boolean;
  isCreatedByMe: boolean;
  isAssignedToMe: boolean;
  cacheStatus?: "fresh" | "cached" | "stale";
  cachedAt?: number;
  description?: string;
  labels?: string[];
  commitsCount?: number;
  commentsCount?: number;
  tasksCount?: number;
  additionsCount?: number;
  deletionsCount?: number;
  checks?: {
    passing: number;
    failing: number;
    pending: number;
  };
  approvals?: {
    received: number;
    required: number;
  };
  requestedReviewers?: string[];
  changedFileGroups?: Array<{
    label: string;
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
    }>;
  }>;
  activity?: Array<{
    actor: string;
    detail: string;
    age: string;
  }>;
};

export type QueueGroupDefinition = {
  id: QueueState;
  label: string;
  description: string;
};

export type ReviewQueueWorkbenchProps = {
  pullRequests: ReviewInboxPullRequest[];
  selectedRowId?: string;
  activeFilter?: ReviewInboxFilter;
  sourceFilter?: ReviewInboxSourceFilter;
  searchQuery: string;
  loading: boolean;
  refreshing: boolean;
  selectedDetailsLoading?: boolean;
  error?: string;
  providersEnabled: boolean;
  onSelectRow: (pullRequest: ReviewInboxPullRequest) => void;
  onActiveFilterChange: (filter: ReviewInboxFilter) => void;
  onSourceFilterChange: (sourceFilter: ReviewInboxSourceFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onRefresh: () => void;
  onPrepare: (pullRequest?: ReviewInboxPullRequest) => void;
  onOpenSettings: () => void;
  onOpenProvider: (pullRequest: ReviewInboxPullRequest) => void;
};
