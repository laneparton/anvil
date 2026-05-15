import type {
  ReviewInboxFilter,
  ReviewInboxPullRequest,
  ReviewInboxSourceFilter,
} from "@/app/LauncherScreen";

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
  sourceFilter: ReviewInboxSourceFilter;
  searchQuery: string;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  providersEnabled: boolean;
  onSelectRow: (pullRequest: ReviewInboxPullRequest) => void;
  onActiveFilterChange: (filter: ReviewInboxFilter) => void;
  onSourceFilterChange: (source: ReviewInboxSourceFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onRefresh: () => void;
  onPrepare: (pullRequest?: ReviewInboxPullRequest) => void;
  onOpenSettings: () => void;
  onOpenProvider: (pullRequest: ReviewInboxPullRequest) => void;
};
