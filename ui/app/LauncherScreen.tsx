import * as React from "react";
import {
  Cloud,
  GitPullRequest,
  Inbox,
  ListFilter,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  UserCheck,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/app/AppShell";
import { appDescriptor, appName } from "@/app/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ReviewPullRequest, ReviewRepo } from "@/lib/api";
import { cn } from "@/lib/utils";

const reviewSources = [
  {
    id: "github",
    name: "GitHub",
    icon: GitPullRequest,
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    icon: Cloud,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  icon: LucideIcon;
}>;

const inboxFilters = [
  { id: "needsReview", label: "Needs review", icon: Inbox },
  { id: "createdByMe", label: "Created by me", icon: UserRound },
  { id: "assignedToMe", label: "Assigned to me", icon: UserCheck },
  { id: "allOpen", label: "All open", icon: ListFilter },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
}>;

export type ReviewSourceId = (typeof reviewSources)[number]["id"];
export type ReviewInboxFilter = (typeof inboxFilters)[number]["id"];
export type ReviewInboxSourceFilter = ReviewSourceId | "all";

export type ReviewInboxPullRequest = ReviewPullRequest & {
  pullRequestId?: string;
  number?: string | number;
  provider?: string;
  source?: ReviewSourceId | string;
  repoId?: string;
  repoName?: string;
  reviewStatus?: ReviewInboxFilter;
  isCreatedByMe?: boolean;
  isAssignedToMe?: boolean;
  needsReview?: boolean;
  updatedAt?: string;
};

export type LauncherScreenProps = {
  pullRequests?: ReviewInboxPullRequest[];
  repos?: ReviewRepo[];
  selectedRowId?: string;
  activeFilter?: ReviewInboxFilter;
  sourceFilter?: ReviewInboxSourceFilter;
  searchQuery?: string;
  loading?: boolean;
  refreshing?: boolean;
  error?: string;
  onSelectRow?: (pullRequestId: string, pullRequest: ReviewInboxPullRequest) => void;
  onActiveFilterChange?: (filter: ReviewInboxFilter) => void;
  onSourceFilterChange?: (source: ReviewInboxSourceFilter) => void;
  onSearchQueryChange?: (query: string) => void;
  onRefresh?: () => void;
  onPrepare?: (pullRequest?: ReviewInboxPullRequest) => void;
  onOpenSettings?: () => void;

  selectedSource?: ReviewSourceId;
  selectedRepo?: string;
  selectedPullRequest?: string;
  loadingRepos?: boolean;
  loadingPullRequests?: boolean;
  repoSearch?: string;
  onSelectSource?: (source: ReviewSourceId) => void;
  onSelectRepo?: (repoId: string) => void;
  onSelectPullRequest?: (pullRequestId: string) => void;
  onRepoSearchChange?: (query: string) => void;
};

const EMPTY_PULL_REQUESTS: ReviewInboxPullRequest[] = [];
const EMPTY_REPOS: ReviewRepo[] = [];

export function LauncherScreen({
  pullRequests = EMPTY_PULL_REQUESTS,
  repos = EMPTY_REPOS,
  selectedRowId,
  activeFilter = "needsReview",
  sourceFilter,
  searchQuery,
  loading,
  refreshing = false,
  error,
  onSelectRow,
  onActiveFilterChange,
  onSourceFilterChange,
  onSearchQueryChange,
  onRefresh,
  onPrepare,
  onOpenSettings,
  selectedSource,
  selectedPullRequest,
  loadingRepos = false,
  loadingPullRequests = false,
  repoSearch,
  onSelectSource,
  onSelectRepo,
  onSelectPullRequest,
  onRepoSearchChange,
}: LauncherScreenProps) {
  const resolvedSourceFilter = sourceFilter ?? selectedSource ?? "all";
  const resolvedSearchQuery = searchQuery ?? repoSearch ?? "";
  const resolvedSelectedRowId = selectedRowId ?? selectedPullRequest ?? "";
  const isLoading = loading ?? (loadingRepos || loadingPullRequests);
  const isFetching = isLoading || refreshing;
  const normalizedQuery = resolvedSearchQuery.trim().toLowerCase();
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualUrl, setManualUrl] = React.useState("");
  const [manualError, setManualError] = React.useState<string | undefined>();

  const inboxRows = pullRequests.map((pullRequest) => normalizePullRequest(pullRequest, repos, selectedSource));
  const sourceFilteredRows = inboxRows.filter((row) => matchesSourceFilter(row, resolvedSourceFilter));
  const filteredRows = sourceFilteredRows.filter((row) => {
    if (!matchesInboxFilter(row, activeFilter)) return false;
    if (!normalizedQuery) return true;

    return [row.title, row.repoLabel, row.providerLabel, row.author, String(row.number)]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const selectedPullRequestRow =
    filteredRows.find((row) => row.id === resolvedSelectedRowId) ??
    inboxRows.find((row) => row.id === resolvedSelectedRowId) ??
    filteredRows[0];
  const sourceCounts = countSources(inboxRows);
  const filterCounts = countFilters(sourceFilteredRows);

  const handleSearchChange = (query: string) => {
    onSearchQueryChange?.(query);
    onRepoSearchChange?.(query);
  };

  const handleSourceChange = (source: ReviewInboxSourceFilter) => {
    onSourceFilterChange?.(source);
    if (source !== "all") {
      onSelectSource?.(source);
    }
  };

  const handleRowSelect = (row: NormalizedPullRequest) => {
    onSelectRow?.(row.id, row.raw);
    onSelectPullRequest?.(row.id);
    if (row.repoId) {
      onSelectRepo?.(row.repoId);
    }
    if (row.source !== "unknown") {
      onSelectSource?.(row.source as ReviewSourceId);
    }
  };

  const handleManualPrepare = () => {
    const parsed = parseManualPullRequestUrl(manualUrl.trim());
    if (!parsed) {
      setManualError("Enter a GitHub or Bitbucket pull request URL.");
      return;
    }

    setManualError(undefined);
    setManualOpen(false);
    onPrepare?.({
      id: `manual:${parsed.source}:${parsed.repo}:${parsed.number}`,
      pullRequestId: parsed.number,
      number: parsed.number,
      title: `Manual PR #${parsed.number}`,
      repo: parsed.repo,
      repoId: parsed.repo,
      repoName: parsed.repo,
      provider: sourceName(parsed.source),
      source: parsed.source,
      author: "manual",
      age: "now",
      files: null,
      status: "open",
      url: parsed.url,
      needsReview: true,
    });
  };

  return (
    <AppShell
      title={appName}
      subtitle={appDescriptor}
      actions={
        <Button
          type="button"
          className="h-8 border-border bg-background px-2 text-xs hover:bg-accent"
          onClick={onOpenSettings}
          data-testid="open-settings"
        >
          <Settings className="size-3.5" />
          Settings
        </Button>
      }
    >
      <section className="h-full min-h-0 overflow-hidden p-5">
        <div
          className="mx-auto grid h-full min-h-0 w-full max-w-7xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3"
          data-testid="review-inbox"
        >
          <div className="flex items-end justify-between gap-4 border-b pb-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Review inbox</h2>
              <p className="mt-1 text-sm leading-6 text-foreground">
                Triage open pull requests and prepare the next review from one queue.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                className="h-8 border-border bg-background px-3 text-xs"
                onClick={() => {
                  setManualError(undefined);
                  setManualOpen(true);
                }}
                data-testid="open-manual-pr"
              >
                <GitPullRequest className="size-3.5" />
                Open PR manually
              </Button>
              <Button
                type="button"
                className="h-8 border-border bg-background px-3 text-xs"
                onClick={onRefresh}
                disabled={refreshing || isLoading}
                data-testid="refresh-inbox"
              >
                {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Refresh
              </Button>
              <Button
                type="button"
                className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                onClick={() => onPrepare?.(selectedPullRequestRow?.raw)}
                disabled={!selectedPullRequestRow || isLoading}
              >
                <GitPullRequest className="size-3.5" />
                Prepare review
              </Button>
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="inline-flex min-w-0 overflow-hidden rounded-md border bg-background p-0.5">
              {inboxFilters.map((filter) => {
                const Icon = filter.icon;
                const selected = activeFilter === filter.id;

                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => onActiveFilterChange?.(filter.id)}
                    data-testid={`inbox-filter-${filter.id}`}
                    className={cn(
                      "flex min-w-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{filter.label}</span>
                    <span
                      className={cn("font-mono", selected ? "text-primary-foreground/80" : "text-muted-foreground")}
                    >
                      {filterCounts[filter.id]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <SourceFilterButton
                label="All sources"
                selected={resolvedSourceFilter === "all"}
                count={inboxRows.length}
                onClick={() => handleSourceChange("all")}
              />
              {reviewSources.map((source) => {
                const Icon = source.icon;
                return (
                  <SourceFilterButton
                    key={source.id}
                    label={source.name}
                    icon={Icon}
                    selected={resolvedSourceFilter === source.id}
                    count={sourceCounts[source.id]}
                    onClick={() => handleSourceChange(source.id)}
                  />
                );
              })}
            </div>
          </div>

          <Card className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-border bg-card shadow-none">
            <CardHeader className="grid gap-2 border-b px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pull requests</h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <GitPullRequest className="size-3.5" />}
                  <span data-testid="review-inbox-status">
                    {isFetching ? "Loading" : `${filteredRows.length} visible`}
                  </span>
                </div>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={resolvedSearchQuery}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder="Search title, repo, author, number"
                  className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                />
              </label>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto p-2" data-testid="pull-request-list">
              {filteredRows.length > 0 ? (
                <div className="grid gap-1.5">
                  {filteredRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => handleRowSelect(row)}
                      data-testid="pull-request-row"
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                        row.id === selectedPullRequestRow?.id
                          ? "border-primary/35 bg-primary/10"
                          : "border-transparent hover:bg-accent",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold">{row.title}</span>
                          <Badge className="shrink-0 border-border bg-background font-mono text-[11px] text-muted-foreground">
                            #{row.number}
                          </Badge>
                        </span>
                        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge className="border-border bg-background text-[11px] text-muted-foreground">
                            {row.providerLabel}
                          </Badge>
                          <Badge className="max-w-56 truncate border-border bg-background font-mono text-[11px] text-foreground">
                            {row.repoLabel}
                          </Badge>
                          <span className="truncate">{row.author}</span>
                          <span>{row.age}</span>
                        </span>
                      </span>
                      <span className="grid justify-items-end gap-1 text-xs text-muted-foreground">
                        {row.filesLabel ? <span className="font-mono text-foreground">{row.filesLabel}</span> : null}
                        <span>{row.statusLabel}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : isFetching ? (
                <div className="grid place-items-center px-3 py-12 text-center">
                  <div className="max-w-sm">
                    <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">Loading PRs</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Fetching open pull requests from your review sources.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid place-items-center px-3 py-12 text-center">
                  <div className="max-w-sm">
                    <Inbox className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">No pull requests match this inbox.</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Try another tab, source, or search query.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {error ? (
            <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        {manualOpen ? (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-pr-title"
          >
            <div className="grid w-full max-w-lg gap-4 rounded-lg border bg-card p-4 shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <h3 id="manual-pr-title" className="text-sm font-semibold">
                  Open PR manually
                </h3>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setManualOpen(false)}
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>
              <label className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Pull request URL
                </span>
                <input
                  value={manualUrl}
                  onChange={(event) => {
                    setManualUrl(event.target.value);
                    setManualError(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleManualPrepare();
                    }
                  }}
                  placeholder="https://bitbucket.org/workspace/repo/pull-requests/45"
                  className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/50"
                  data-testid="manual-pr-url"
                />
              </label>
              {manualError ? <div className="text-xs text-destructive">{manualError}</div> : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="h-8 border-border bg-background px-3 text-xs hover:bg-accent"
                  onClick={() => setManualOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                  onClick={handleManualPrepare}
                  data-testid="manual-pr-prepare"
                >
                  Prepare
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

export const ReviewLauncher = LauncherScreen;

type NormalizedPullRequest = {
  id: string;
  title: string;
  repoId: string;
  repoLabel: string;
  providerLabel: string;
  source: string;
  number: string | number;
  author: string;
  age: string;
  filesLabel?: string;
  statusLabel: string;
  raw: ReviewInboxPullRequest;
  reviewStatus?: ReviewInboxFilter;
  isCreatedByMe: boolean;
  isAssignedToMe: boolean;
  needsReview: boolean;
};

function normalizePullRequest(
  pullRequest: ReviewInboxPullRequest,
  repos: ReviewRepo[],
  selectedSource: ReviewSourceId | undefined,
): NormalizedPullRequest {
  const repo = repos.find((candidate) => candidate.id === pullRequest.repo || candidate.name === pullRequest.repo);
  const providerLabel = pullRequest.provider ?? repo?.provider ?? sourceName(pullRequest.source ?? selectedSource);
  const source = normalizeSource(pullRequest.source ?? providerLabel ?? selectedSource);
  const number = pullRequest.number ?? pullRequest.id;

  return {
    id: pullRequest.id,
    title: pullRequest.title,
    repoId: pullRequest.repoId ?? repo?.id ?? pullRequest.repo,
    repoLabel: pullRequest.repoName ?? repo?.name ?? pullRequest.repo,
    providerLabel,
    source,
    number,
    author: pullRequest.author,
    age: pullRequest.age,
    filesLabel:
      pullRequest.files === null || pullRequest.files === undefined ? undefined : `${pullRequest.files} files`,
    statusLabel: pullRequest.status || "open",
    raw: pullRequest,
    reviewStatus: pullRequest.reviewStatus,
    isCreatedByMe: Boolean(pullRequest.isCreatedByMe),
    isAssignedToMe: Boolean(pullRequest.isAssignedToMe),
    needsReview:
      pullRequest.needsReview ?? (pullRequest.reviewStatus ? pullRequest.reviewStatus === "needsReview" : true),
  };
}

function matchesInboxFilter(row: NormalizedPullRequest, filter: ReviewInboxFilter) {
  if (filter === "allOpen") return true;
  if (filter === "createdByMe") return row.isCreatedByMe || row.reviewStatus === "createdByMe";
  if (filter === "assignedToMe") return row.isAssignedToMe || row.reviewStatus === "assignedToMe";
  return row.needsReview || row.reviewStatus === "needsReview";
}

function matchesSourceFilter(row: NormalizedPullRequest, sourceFilter: ReviewInboxSourceFilter) {
  return sourceFilter === "all" || row.source === sourceFilter;
}

export function parseManualPullRequestUrl(
  value: string,
): { source: ReviewSourceId; repo: string; number: string; url: string } | undefined {
  const url = parseUrl(value.trim());
  if (!url) return undefined;

  const hostname = url.hostname.replace(/^www\./, "");
  if (hostname === "github.com") {
    const [, owner, repo, kind, number] = url.pathname.split("/");
    if (owner && repo && kind === "pull" && number && /^\d+$/.test(number)) {
      return { source: "github", repo: `${owner}/${repo}`, number, url: url.toString() };
    }
  }
  if (hostname === "bitbucket.org") {
    const [, workspace, repo, kind, number] = url.pathname.split("/");
    if (workspace && repo && kind === "pull-requests" && number && /^\d+$/.test(number)) {
      return { source: "bitbucket", repo: `${workspace}/${repo}`, number, url: url.toString() };
    }
  }

  return undefined;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return undefined;
    }
  }
}

function countFilters(rows: NormalizedPullRequest[]) {
  return inboxFilters.reduce(
    (counts, filter) => ({
      ...counts,
      [filter.id]: rows.filter((row) => matchesInboxFilter(row, filter.id)).length,
    }),
    {} as Record<ReviewInboxFilter, number>,
  );
}

function countSources(rows: NormalizedPullRequest[]) {
  return reviewSources.reduce(
    (counts, source) => ({
      ...counts,
      [source.id]: rows.filter((row) => row.source === source.id).length,
    }),
    {} as Record<ReviewSourceId, number>,
  );
}

function normalizeSource(source: ReviewInboxPullRequest["source"] | string | undefined) {
  const value = String(source ?? "")
    .trim()
    .toLowerCase();
  if (["bitbucket", "bitbucket.org", "bitbucket cloud"].includes(value)) return "bitbucket";
  if (["github", "github.com", "github enterprise", "github enterprise server"].includes(value)) return "github";
  return "unknown";
}

function sourceName(source: ReviewInboxPullRequest["source"] | undefined) {
  const normalized = normalizeSource(source);
  return reviewSources.find((candidate) => candidate.id === normalized)?.name ?? "Unknown";
}

function SourceFilterButton({
  label,
  icon: Icon,
  selected,
  count,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  selected: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
        selected
          ? "border-primary/35 bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent",
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
      <span className="font-mono text-muted-foreground">{count}</span>
    </button>
  );
}
