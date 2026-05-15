import * as React from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Cloud,
  ExternalLink,
  FileCode2,
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
} from "lucide-react";

import { AppShell } from "@/app/AppShell";
import {
  parseManualPullRequestUrl,
  type ReviewInboxFilter,
  type ReviewInboxPullRequest,
  type ReviewInboxSourceFilter,
} from "@/app/LauncherScreen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RuntimeQueueState = "needs-review" | "created-by-me" | "assigned-to-me" | "all-open";

type RuntimeQueuePullRequest = {
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

const runtimeQueueGroups: Array<{
  id: RuntimeQueueState;
  label: string;
  description: string;
}> = [
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

type RuntimeReviewQueueWorkbenchProps = {
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

export function ReviewQueueWorkbench({
  pullRequests,
  selectedRowId,
  activeFilter = "allOpen",
  sourceFilter,
  searchQuery,
  loading,
  refreshing,
  error,
  providersEnabled,
  onSelectRow,
  onActiveFilterChange,
  onSourceFilterChange,
  onSearchQueryChange,
  onRefresh,
  onPrepare,
  onOpenSettings,
  onOpenProvider,
}: RuntimeReviewQueueWorkbenchProps) {
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualUrl, setManualUrl] = React.useState("");
  const [manualError, setManualError] = React.useState<string | undefined>();
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const rows = React.useMemo(() => pullRequests.map(normalizeRuntimePullRequest), [pullRequests]);
  const sourceFilteredRows = rows.filter((row) => matchesRuntimeSource(row, sourceFilter));
  const filteredRows = sourceFilteredRows.filter((row) => {
    if (!normalizedQuery) return true;
    return [row.title, row.repoName, row.repo, row.providerSource, row.author, row.number]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const selected =
    filteredRows.find((row) => row.id === selectedRowId) ??
    rows.find((row) => row.id === selectedRowId) ??
    filteredRows[0];
  const sourceCounts = countRuntimeSources(rows);
  const isFetching = loading || refreshing;

  const handleManualPrepare = () => {
    const parsed = parseManualPullRequestUrl(manualUrl.trim());
    if (!parsed) {
      setManualError("Enter a GitHub or Bitbucket pull request URL.");
      return;
    }

    setManualError(undefined);
    setManualOpen(false);
    onPrepare({
      id: `manual:${parsed.source}:${parsed.repo}:${parsed.number}`,
      pullRequestId: parsed.number,
      number: parsed.number,
      title: `Manual PR #${parsed.number}`,
      repo: parsed.repo,
      repoId: parsed.repo,
      repoName: parsed.repo,
      provider: runtimeSourceName(parsed.source),
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
      title="Anvil"
      subtitle="PR Review Workbench"
      actions={
        <>
          <Button
            type="button"
            className="h-8 border-border bg-background px-2 text-xs hover:bg-accent"
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
            className="size-8 border-border bg-background p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refresh"
            data-testid="refresh-inbox"
          >
            {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>
          <Button
            type="button"
            className="size-8 border-border bg-background p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onOpenSettings}
            aria-label="Settings"
            data-testid="open-settings"
          >
            <Settings className="size-3.5" />
          </Button>
        </>
      }
    >
      <section className="grid h-full min-h-0 grid-cols-[minmax(320px,420px)_minmax(0,1fr)] overflow-hidden" data-testid="review-inbox">
        <aside className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] border-r bg-card">
          <div className="grid gap-3 border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <GitPullRequest className="size-4 text-primary" />
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">Review Queue</h2>
                <p className="truncate text-xs text-muted-foreground">Pick the next PR to open in Anvil.</p>
              </div>
              <Badge className="ml-auto h-7 border-transparent bg-muted px-2 font-mono text-xs text-muted-foreground">
                {pullRequests.length} PRs
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <Inbox className="size-3.5" />}
              <span data-testid="review-inbox-status">
                {isFetching ? "Loading" : `${filteredRows.length} visible`}
              </span>
            </div>
          </div>

          <div className="grid gap-3 border-b px-5 py-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="Search title, repo, author, number"
                className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
            </label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <RuntimeSourceFilterButton
                label="All sources"
                selected={sourceFilter === "all"}
                count={rows.length}
                onClick={() => onSourceFilterChange("all")}
              />
              <RuntimeSourceFilterButton
                label="GitHub"
                icon={GitPullRequest}
                selected={sourceFilter === "github"}
                count={sourceCounts.github}
                onClick={() => onSourceFilterChange("github")}
              />
              <RuntimeSourceFilterButton
                label="Bitbucket"
                icon={Cloud}
                selected={sourceFilter === "bitbucket"}
                count={sourceCounts.bitbucket}
                onClick={() => onSourceFilterChange("bitbucket")}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto" data-testid="pull-request-list">
            {filteredRows.length > 0 ? (
              <div className="grid">
                {runtimeQueueGroups.map((group) => {
                  const groupRows = filteredRows.filter((row) => runtimeRowInGroup(row, group.id));
                  return (
                    <RuntimeQueueGroup
                      key={group.id}
                      group={group}
                      rows={groupRows}
                      selectedId={selected?.id}
                      active={activeFilter === runtimeFilterForGroup(group.id)}
                      onActivate={() => onActiveFilterChange(runtimeFilterForGroup(group.id))}
                      onSelect={(pullRequest) => onSelectRow(pullRequest.raw)}
                    />
                  );
                })}
              </div>
            ) : isFetching ? (
              <RuntimeQueueEmptyState
                icon={<Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />}
                title="Loading PRs"
                detail="Fetching open pull requests from your review sources."
              />
            ) : (
              <RuntimeQueueEmptyState
                icon={<Inbox className="mx-auto size-8 text-muted-foreground" />}
                title={providersEnabled ? "No pull requests match this queue." : "No providers enabled."}
                detail={
                  providersEnabled
                    ? "Try another source or search query."
                    : "Enable GitHub or Bitbucket in Settings to populate the review queue."
                }
              />
            )}
          </div>

          {error ? (
            <div className="border-t border-destructive/25 bg-destructive/10 px-5 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </aside>

        <main className="min-h-0 overflow-hidden bg-background">
          {selected ? (
            <RuntimeQueuePreview
              pullRequest={selected}
              onPrepare={() => onPrepare(selected.raw)}
              onOpenProvider={() => onOpenProvider(selected.raw)}
            />
          ) : (
            <RuntimeQueueNoSelection />
          )}
        </main>
      </section>

      {manualOpen ? (
        <ManualPullRequestDialog
          manualUrl={manualUrl}
          manualError={manualError}
          onUrlChange={(value) => {
            setManualUrl(value);
            setManualError(undefined);
          }}
          onClose={() => setManualOpen(false)}
          onPrepare={handleManualPrepare}
        />
      ) : null}
    </AppShell>
  );
}

function RuntimeQueueGroup({
  group,
  rows,
  selectedId,
  active,
  onActivate,
  onSelect,
}: {
  group: (typeof runtimeQueueGroups)[number];
  rows: RuntimeQueuePullRequest[];
  selectedId?: string;
  active: boolean;
  onActivate: () => void;
  onSelect: (pullRequest: RuntimeQueuePullRequest) => void;
}) {
  const Icon = runtimeQueueGroupIcon(group.id);
  const [expanded, setExpanded] = React.useState(group.id !== "all-open");
  const containsSelected = rows.some((pullRequest) => pullRequest.id === selectedId);

  React.useEffect(() => {
    if (containsSelected && group.id !== "all-open") setExpanded(true);
  }, [containsSelected, group.id]);

  return (
    <section className="border-b">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-accent/45"
        onClick={() => {
          onActivate();
          setExpanded((current) => !current);
        }}
        aria-expanded={expanded}
        data-testid={`inbox-filter-${runtimeFilterForGroup(group.id)}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-xs font-semibold uppercase tracking-wide",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {group.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{group.description}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rows.length}</span>
      </button>
      {expanded ? (
        <div className="grid">
          {rows.length > 0 ? (
            rows.map((pullRequest) => (
              <RuntimeQueueRow
                key={`${group.id}:${pullRequest.id}`}
                pullRequest={pullRequest}
                selected={pullRequest.id === selectedId}
                onSelect={() => onSelect(pullRequest)}
              />
            ))
          ) : (
            <div className="px-5 pb-4 text-xs text-muted-foreground">No matching pull requests.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function RuntimeQueueRow({
  pullRequest,
  selected,
  onSelect,
}: {
  pullRequest: RuntimeQueuePullRequest;
  selected: boolean;
  onSelect: () => void;
}) {
  const ProviderIcon = providerIcon(pullRequest.provider);

  return (
    <button
      type="button"
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-l-2 px-5 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/35",
        selected ? "border-l-primary bg-primary/[0.055]" : "border-l-transparent hover:bg-accent/60",
      )}
      onClick={onSelect}
      data-testid="pull-request-row"
    >
      <span className="grid min-w-0 gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <RuntimeStatusDot pullRequest={pullRequest} />
          <span className="min-w-0 truncate text-sm font-semibold leading-5">{pullRequest.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
          <ProviderIcon className={cn("size-3.5 shrink-0", providerIconTone(pullRequest.provider))} />
          <span className="truncate font-mono text-foreground/75">{pullRequest.repoName}</span>
          <span className="text-muted-foreground/70">#{pullRequest.number}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              {initialsFor(pullRequest.author)}
            </span>
            {pullRequest.author}
          </span>
          <span>{pullRequest.age}</span>
          {pullRequest.changedFilesCount !== undefined ? <span>{pullRequest.changedFilesCount} files</span> : null}
        </span>
      </span>
      <span className="grid content-center justify-items-end gap-2">
        <RuntimeStatusPill status={pullRequest.status} />
        <ChevronRight className={cn("size-4 text-muted-foreground transition-opacity", selected ? "opacity-100" : "opacity-0")} />
      </span>
    </button>
  );
}

function RuntimeQueuePreview({
  pullRequest,
  onPrepare,
  onOpenProvider,
}: {
  pullRequest: RuntimeQueuePullRequest;
  onPrepare: () => void;
  onOpenProvider: () => void;
}) {
  const ProviderIcon = providerIcon(pullRequest.provider);
  const hasBranchRoute = Boolean(pullRequest.sourceBranch || pullRequest.targetBranch);

  return (
    <aside className="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 max-w-3xl">
            <RuntimeStatusPill status={pullRequest.status} />
            <a
              href={pullRequest.url}
              className="mt-3 flex w-fit max-w-full items-center gap-1.5 text-lg font-semibold leading-6 text-foreground underline-offset-4 hover:text-primary hover:underline"
              onClick={(event) => {
                event.preventDefault();
                onOpenProvider();
              }}
            >
              <span className="truncate" data-testid="review-preview-title">{pullRequest.title}</span>
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <ProviderIcon className={cn("size-4", providerIconTone(pullRequest.provider))} />
              <span className="truncate font-mono">{pullRequest.repoName}</span>
              <span className="font-mono text-muted-foreground/70">#{pullRequest.number}</span>
              <span className="text-muted-foreground/45">|</span>
              <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {initialsFor(pullRequest.author)}
              </span>
              <span>{pullRequest.author}</span>
              <span className="text-muted-foreground/45">|</span>
              <span>{pullRequest.providerSource}</span>
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              opened {pullRequest.age}
            </div>
          </div>
          <RuntimePullRequestStats pullRequest={pullRequest} />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <div className="border-b bg-card px-6 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 rounded-md bg-accent px-3 text-sm font-semibold text-foreground"
            >
              Overview
            </button>
          </div>
        </div>

        <div className="grid max-w-4xl gap-5 px-6 py-5">
          <PreviewSection title="Runtime metadata">
            <dl className="grid gap-2 sm:grid-cols-2">
              <RuntimeFact label="Provider" value={pullRequest.providerSource} />
              <RuntimeFact label="Repository" value={pullRequest.repoName} />
              <RuntimeFact label="Author" value={pullRequest.author} />
              <RuntimeFact label="Status" value={pullRequest.status || "open"} />
              {pullRequest.changedFilesCount !== undefined ? (
                <RuntimeFact label="Changed files" value={`${pullRequest.changedFilesCount}`} />
              ) : null}
              {hasBranchRoute ? (
                <RuntimeFact
                  label="Branches"
                  value={`${pullRequest.sourceBranch ?? "head"} -> ${pullRequest.targetBranch ?? "base"}`}
                />
              ) : null}
            </dl>
          </PreviewSection>
          <PreviewSection title="Description">
            <p>Provider description is unavailable until Anvil fetches pull request details.</p>
          </PreviewSection>
        </div>
      </div>

      <div className="grid gap-2 border-t bg-card p-6">
        <Button
          type="button"
          className="h-11 bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          onClick={onPrepare}
        >
          <GitPullRequest className="size-4" />
          Start review
        </Button>
        <Button
          type="button"
          className="h-10 border-border bg-background px-3 text-sm font-semibold hover:bg-accent"
          onClick={onOpenProvider}
          disabled={!pullRequest.url}
        >
          <ExternalLink className="size-4" />
          Open in {pullRequest.provider}
        </Button>
      </div>
    </aside>
  );
}

function RuntimePullRequestStats({ pullRequest }: { pullRequest: RuntimeQueuePullRequest }) {
  const hasBranchRoute = Boolean(pullRequest.sourceBranch || pullRequest.targetBranch);
  if (pullRequest.changedFilesCount === undefined && !hasBranchRoute) return null;

  return (
    <div className="grid shrink-0 justify-items-end gap-2 text-sm text-muted-foreground">
      {pullRequest.changedFilesCount !== undefined ? (
        <span className="flex items-center gap-1.5">
          <FileCode2 className="size-3.5" />
          <span>{pullRequest.changedFilesCount} files</span>
        </span>
      ) : null}
      {hasBranchRoute ? (
        <div className="flex max-w-lg items-center gap-2 font-mono text-muted-foreground">
          <span className="truncate">{pullRequest.sourceBranch ?? "head"}</span>
          <ArrowRight className="size-3.5 shrink-0" />
          <span className="shrink-0">{pullRequest.targetBranch ?? "base"}</span>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-card px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function RuntimeQueueNoSelection() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm">
        <GitPullRequest className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No pull request selected.</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a row from the review queue.</p>
      </div>
    </div>
  );
}

function RuntimeQueueEmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="grid place-items-center px-5 py-12 text-center">
      <div className="max-w-sm">
        {icon}
        <p className="mt-3 text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function ManualPullRequestDialog({
  manualUrl,
  manualError,
  onUrlChange,
  onClose,
  onPrepare,
}: {
  manualUrl: string;
  manualError?: string;
  onUrlChange: (value: string) => void;
  onClose: () => void;
  onPrepare: () => void;
}) {
  return (
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
            onClick={onClose}
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
            onChange={(event) => onUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onPrepare();
            }}
            autoFocus
            placeholder="https://bitbucket.org/workspace/repo/pull-requests/45"
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/50"
            data-testid="manual-pr-url"
          />
        </label>
        {manualError ? <div className="text-xs text-destructive">{manualError}</div> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" className="h-8 border-border bg-background px-3 text-xs hover:bg-accent" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={onPrepare}
            data-testid="manual-pr-prepare"
          >
            Prepare
          </Button>
        </div>
      </div>
    </div>
  );
}

function RuntimeSourceFilterButton({
  label,
  icon: Icon,
  selected,
  count,
  onClick,
}: {
  label: string;
  icon?: typeof GitPullRequest;
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

function normalizeRuntimePullRequest(pullRequest: ReviewInboxPullRequest): RuntimeQueuePullRequest {
  const provider = runtimeProviderName(pullRequest.provider ?? pullRequest.source);
  const source = runtimeSourceId(pullRequest.source ?? pullRequest.provider);
  const number = String(pullRequest.number ?? pullRequest.pullRequestId ?? pullRequest.id);
  const changedFilesCount =
    pullRequest.files === null || pullRequest.files === undefined ? undefined : Number(pullRequest.files);

  return {
    id: pullRequest.id,
    raw: pullRequest,
    provider,
    providerSource: pullRequest.provider ?? runtimeSourceName(source),
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

function runtimeRowInGroup(row: RuntimeQueuePullRequest, group: RuntimeQueueState) {
  if (group === "all-open") return true;
  if (group === "created-by-me") return row.isCreatedByMe;
  if (group === "assigned-to-me") return row.isAssignedToMe;
  return row.needsReview;
}

function runtimeFilterForGroup(group: RuntimeQueueState): ReviewInboxFilter {
  if (group === "created-by-me") return "createdByMe";
  if (group === "assigned-to-me") return "assignedToMe";
  if (group === "all-open") return "allOpen";
  return "needsReview";
}

function matchesRuntimeSource(row: RuntimeQueuePullRequest, sourceFilter: ReviewInboxSourceFilter) {
  return sourceFilter === "all" || row.source === sourceFilter;
}

function countRuntimeSources(rows: RuntimeQueuePullRequest[]) {
  return {
    github: rows.filter((row) => row.source === "github").length,
    bitbucket: rows.filter((row) => row.source === "bitbucket").length,
  };
}

function runtimeSourceId(source: unknown) {
  const value = String(source ?? "").toLowerCase();
  if (value.includes("bitbucket")) return "bitbucket";
  if (value.includes("github")) return "github";
  return "unknown";
}

function runtimeSourceName(source: unknown) {
  const normalized = runtimeSourceId(source);
  if (normalized === "bitbucket") return "Bitbucket";
  if (normalized === "github") return "GitHub";
  return "Unknown";
}

function runtimeProviderName(source: unknown): RuntimeQueuePullRequest["provider"] {
  const name = runtimeSourceName(source);
  return name === "GitHub" || name === "Bitbucket" ? name : "Unknown";
}

function runtimeQueueGroupIcon(queueState: RuntimeQueueState) {
  if (queueState === "created-by-me") return UserRound;
  if (queueState === "assigned-to-me") return UserCheck;
  if (queueState === "all-open") return ListFilter;
  return Inbox;
}

function RuntimeStatusDot({ pullRequest }: { pullRequest: RuntimeQueuePullRequest }) {
  return (
    <span
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        pullRequest.needsReview
          ? "bg-primary"
          : pullRequest.isAssignedToMe
            ? "bg-anvil-info"
            : "bg-muted-foreground/55",
      )}
    />
  );
}

function RuntimeStatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs font-semibold capitalize text-muted-foreground">
      {status || "open"}
    </span>
  );
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function providerIcon(provider: string) {
  return provider === "Bitbucket" ? Cloud : GitPullRequest;
}

function providerIconTone(provider: string) {
  return provider === "Bitbucket" ? "text-anvil-info" : "text-foreground/70";
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 text-sm leading-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}
