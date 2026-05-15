import * as React from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Circle,
  Cloud,
  ExternalLink,
  Eye,
  FileCode2,
  GitCommit,
  GitPullRequest,
  Inbox,
  ListFilter,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
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
import {
  prototypePreparationPhases,
  prototypePreparationStates,
  prototypePullRequest,
  prototypeQueueGroups,
  prototypeQueuePullRequests,
  prototypeSlices,
  type PrototypePreparationPhaseId,
  type PrototypePreparationState,
  type PrototypeQueuePullRequest,
  type PrototypeQueueState,
  type PrototypeSlice,
  type PrototypeSliceStatus,
} from "@/app/experience-prototype-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SliceDecisionMap = Record<string, PrototypeSliceStatus>;
type DraftMap = Record<string, string>;
type PreferredAgent = "codex" | "claude";
type ReviewDisposition = "request-changes" | "comment";

const initialDecisions = Object.fromEntries(
  prototypeSlices.map((slice) => [slice.id, slice.status]),
) as SliceDecisionMap;
const initialDrafts = Object.fromEntries(
  prototypeSlices.filter((slice) => slice.commentDraft).map((slice) => [slice.id, slice.commentDraft ?? ""]),
) as DraftMap;
const providerAuthor = {
  name: "Lane Parton",
  initials: "LP",
};

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

export function RuntimeReviewQueueWorkbench({
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

export function ReviewQueuePrototype() {
  const [selectedId, setSelectedId] = React.useState(prototypeQueuePullRequests[0]?.id ?? "");
  const selected =
    prototypeQueuePullRequests.find((pullRequest) => pullRequest.id === selectedId) ??
    prototypeQueuePullRequests[0];

  return (
    <AppShell
      title="Anvil"
      subtitle="PR Review Workbench"
      actions={
        <>
          <Button
            type="button"
            className="size-8 border-transparent bg-transparent p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            type="button"
            className="size-8 border-transparent bg-transparent p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="size-4" />
          </Button>
          <div className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            LP
          </div>
        </>
      }
    >
      <section className="grid h-full min-h-0 grid-cols-[420px_minmax(0,1fr)] overflow-hidden">
        <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r bg-card">
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <GitPullRequest className="size-4 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">Review Queue</h2>
              <p className="truncate text-xs text-muted-foreground">Pick the next PR to open in Anvil.</p>
            </div>
            <Badge className="ml-auto h-7 border-transparent bg-muted px-2 font-mono text-xs text-muted-foreground">
              {prototypeQueuePullRequests.length} PRs
            </Badge>
          </div>
          <div className="min-h-0 overflow-y-auto">
            <div className="grid gap-3">
              {prototypeQueueGroups.map((group) => {
                const rows = prototypeQueuePullRequests.filter((pullRequest) => pullRequest.queueState === group.id);
                return (
                  <QueueGroup
                    key={group.id}
                    group={group}
                    rows={rows}
                    selectedId={selected.id}
                    onSelect={setSelectedId}
                  />
                );
              })}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden bg-background">
          <QueuePreview pullRequest={selected} />
        </main>
      </section>
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

function QueueGroup({
  group,
  rows,
  selectedId,
  onSelect,
}: {
  group: (typeof prototypeQueueGroups)[number];
  rows: PrototypeQueuePullRequest[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const Icon = queueGroupIcon(group.id);
  const [expanded, setExpanded] = React.useState(group.id !== "all-open");
  const containsSelected = rows.some((pullRequest) => pullRequest.id === selectedId);

  React.useEffect(() => {
    if (containsSelected) setExpanded(true);
  }, [containsSelected]);

  return (
    <section className="border-b">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-accent/45"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <Icon className="size-4 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rows.length}</span>
      </button>
      {expanded ? (
        <div className="grid">
          {rows.map((pullRequest) => (
            <QueuePullRequestRow
              key={pullRequest.id}
              pullRequest={pullRequest}
              selected={pullRequest.id === selectedId}
              onSelect={() => onSelect(pullRequest.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function QueuePullRequestRow({
  pullRequest,
  selected,
  onSelect,
}: {
  pullRequest: PrototypeQueuePullRequest;
  selected: boolean;
  onSelect: () => void;
}) {
  const ProviderIcon = providerIcon(pullRequest.provider);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-l-2 px-5 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/35",
        selected ? "border-l-primary bg-primary/[0.055]" : "border-l-transparent hover:bg-accent/60",
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="grid min-w-0 gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot pullRequest={pullRequest} />
          <span className="min-w-0 truncate text-sm font-semibold leading-5">{pullRequest.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
          <ProviderIcon className={cn("size-3.5 shrink-0", providerIconTone(pullRequest.provider))} />
          <span className="truncate font-mono text-foreground/75">{pullRequest.repo}</span>
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
          <span>{pullRequest.changedFilesCount} files</span>
          <span>{pullRequest.commitsCount} commits</span>
        </span>
      </span>
      <span className="grid content-center justify-items-end gap-2">
        <SizeBadge size={pullRequest.estimatedReviewSize} />
        <ChevronRight className={cn("size-4 text-muted-foreground transition-opacity", selected ? "opacity-100" : "opacity-0")} />
      </span>
    </div>
  );
}

function QueuePreview({ pullRequest }: { pullRequest: PrototypeQueuePullRequest }) {
  const [activeTab, setActiveTab] = React.useState<"files" | "description" | "activity">("files");
  const totalChecks = pullRequest.checks.passing + pullRequest.checks.failing + pullRequest.checks.pending;
  const blockers = getReadinessBlockers(pullRequest);
  const openItemCount = blockers.length;
  const ready = openItemCount === 0;
  const ProviderIcon = providerIcon(pullRequest.provider);

  return (
    <aside className="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 max-w-3xl">
            <ReadinessPill ready={ready} />
            <a
              href={pullRequest.url}
              className="mt-3 flex w-fit max-w-full items-center gap-1.5 text-lg font-semibold leading-6 text-foreground underline-offset-4 hover:text-primary hover:underline"
              onClick={(event) => event.preventDefault()}
            >
              <span className="truncate">{pullRequest.title}</span>
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <ProviderIcon className={cn("size-4", providerIconTone(pullRequest.provider))} />
              <span className="truncate font-mono">{pullRequest.repo}</span>
              <span className="font-mono text-muted-foreground/70">#{pullRequest.number}</span>
              <span className="text-muted-foreground/45">|</span>
              <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {initialsFor(pullRequest.author)}
              </span>
              <span>{pullRequest.author}</span>
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {pullRequest.providerSource} · opened {pullRequest.age} ago
            </div>
          </div>
          <PullRequestStats pullRequest={pullRequest} />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <ProviderStatusStrip pullRequest={pullRequest} totalChecks={totalChecks} />

        <div className="border-b bg-card px-6 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(
                "h-8 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground",
                activeTab === "files" && "bg-accent text-foreground",
              )}
              onClick={() => setActiveTab("files")}
            >
              Files ({pullRequest.changedFilesCount})
            </button>
            <button
              type="button"
              className={cn(
                "h-8 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground",
                activeTab === "description" && "bg-accent text-foreground",
              )}
              onClick={() => setActiveTab("description")}
            >
              Description
            </button>
            <button
              type="button"
              className={cn(
                "h-8 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground",
                activeTab === "activity" && "bg-accent text-foreground",
              )}
              onClick={() => setActiveTab("activity")}
            >
              Activity ({pullRequest.activity.length})
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {activeTab === "files" ? (
            <ChangedFilesMap pullRequest={pullRequest} />
          ) : activeTab === "description" ? (
            <DescriptionPreview pullRequest={pullRequest} />
          ) : (
            <ActivityPreview pullRequest={pullRequest} />
          )}
        </div>
      </div>

      <div className="grid gap-2 border-t bg-card p-6">
        <Button
          type="button"
          className="h-11 bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          onClick={() => navigatePrototype("preparing-review")}
        >
          <GitPullRequest className="size-4" />
          Start review
        </Button>
        <Button type="button" className="h-10 border-border bg-background px-3 text-sm font-semibold hover:bg-accent">
          <ExternalLink className="size-4" />
          Open in {pullRequest.provider}
        </Button>
      </div>
    </aside>
  );
}

function PullRequestStats({ pullRequest }: { pullRequest: PrototypeQueuePullRequest }) {
  return (
    <div className="grid shrink-0 justify-items-end gap-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <FileCode2 className="size-3.5" />
          <span className="font-semibold text-foreground">{sizeInitial(pullRequest.estimatedReviewSize)}</span>
          <span>{pullRequest.changedFilesCount} files</span>
        </span>
        <span className="flex items-center gap-1.5">
          <GitCommit className="size-3.5" />
          {pullRequest.commitsCount}
        </span>
        <span className="flex items-center gap-1.5">
          <MessageSquare className="size-3.5" />
          {pullRequest.commentsCount}
        </span>
      </div>
      <div className="flex items-center gap-3 font-mono">
        <span className="flex items-center gap-1 text-primary">
          <Plus className="size-3.5" />
          {pullRequest.additionsCount}
        </span>
        <span className="flex items-center gap-1 text-destructive">
          <Minus className="size-3.5" />
          {pullRequest.deletionsCount}
        </span>
      </div>
      <div className="flex max-w-lg items-center gap-2 font-mono text-muted-foreground">
        <span className="truncate">{pullRequest.sourceBranch}</span>
        <ArrowRight className="size-3.5 shrink-0" />
        <span className="shrink-0">{pullRequest.targetBranch}</span>
      </div>
    </div>
  );
}

function ProviderStatusStrip({
  pullRequest,
  totalChecks,
}: {
  pullRequest: PrototypeQueuePullRequest;
  totalChecks: number;
}) {
  const approvalNeeded = Math.max(pullRequest.approvals.required - pullRequest.approvals.received, 0);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-card px-6 py-3.5 text-sm">
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground">Checks</span>
        <span className="flex items-center gap-1">
          {Array.from({ length: pullRequest.checks.passing }).map((_, index) => (
            <CheckCircle2 key={`passing-${index}`} className="size-4 text-primary" />
          ))}
          {Array.from({ length: pullRequest.checks.pending }).map((_, index) => (
            <Circle key={`pending-${index}`} className="size-4 text-anvil-attention" />
          ))}
          {Array.from({ length: pullRequest.checks.failing }).map((_, index) => (
            <CircleAlert key={`failing-${index}`} className="size-4 text-destructive" />
          ))}
        </span>
        <span
          className={cn(
            "font-semibold",
            pullRequest.checks.failing > 0
              ? "text-destructive"
              : pullRequest.checks.pending > 0
                ? "text-anvil-attention"
                : "text-primary",
          )}
        >
          {pullRequest.checks.pending > 0 ? `${pullRequest.checks.pending} pending` : `${pullRequest.checks.passing}/${totalChecks}`}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">Reviews</span>
        <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
          {initialsFor("Lane Parton")}
        </span>
        {pullRequest.requestedReviewers.slice(1).map((reviewer) => (
          <span
            key={reviewer}
            title={reviewer}
            className="grid size-6 place-items-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary"
          >
            {initialsFor(reviewer)}
          </span>
        ))}
        <span className={cn("font-semibold", approvalNeeded > 0 ? "text-anvil-attention" : "text-primary")}>
          {pullRequest.approvals.received}
        </span>
        {approvalNeeded > 0 ? <span className="text-muted-foreground">({approvalNeeded} pending)</span> : null}
      </span>
    </div>
  );
}

function ChangedFilesMap({ pullRequest }: { pullRequest: PrototypeQueuePullRequest }) {
  const maxTotal = Math.max(
    1,
    ...pullRequest.changedFileGroups.flatMap((group) =>
      group.files.map((file) => file.additions + file.deletions),
    ),
  );

  return (
    <div className="grid gap-5">
      {pullRequest.changedFileGroups.map((group) => (
        <section key={group.label} className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>
          <div className="grid gap-2">
            {group.files.map((file) => (
              <ChangedFileRow key={file.path} file={file} maxTotal={maxTotal} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ChangedFileRow({
  file,
  maxTotal,
}: {
  file: PrototypeQueuePullRequest["changedFileGroups"][number]["files"][number];
  maxTotal: number;
}) {
  const total = file.additions + file.deletions;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8rem_5rem] items-center gap-4 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <FileCode2 className={cn("size-4 shrink-0", file.deletions > 0 ? "text-anvil-info" : "text-primary")} />
        <span className="truncate font-mono text-foreground/85">{file.path}</span>
      </span>
      <DiffBar additions={file.additions} deletions={file.deletions} total={total} maxTotal={maxTotal} />
      <span className="text-right font-mono text-xs">
        {file.additions > 0 ? <span className="text-primary">+{file.additions}</span> : null}
        {file.additions > 0 && file.deletions > 0 ? <span className="text-muted-foreground"> </span> : null}
        {file.deletions > 0 ? <span className="text-destructive">-{file.deletions}</span> : null}
        {total === 0 ? <span className="text-muted-foreground">0</span> : null}
      </span>
    </div>
  );
}

function DiffBar({
  additions,
  deletions,
  total,
  maxTotal,
}: {
  additions: number;
  deletions: number;
  total: number;
  maxTotal: number;
}) {
  const width = Math.max(total === 0 ? 0 : 12, Math.round((total / maxTotal) * 100));
  const addWidth = total === 0 ? 0 : Math.round((additions / total) * 100);
  const deleteWidth = total === 0 ? 0 : 100 - addWidth;

  return (
    <span className="flex h-1.5 justify-end overflow-hidden rounded-full bg-muted">
      <span className="flex h-full overflow-hidden rounded-full" style={{ width: `${width}%` }}>
        {additions > 0 ? <span className="h-full bg-primary" style={{ width: `${addWidth}%` }} /> : null}
        {deletions > 0 ? <span className="h-full bg-destructive" style={{ width: `${deleteWidth}%` }} /> : null}
      </span>
    </span>
  );
}

function ActivityPreview({ pullRequest }: { pullRequest: PrototypeQueuePullRequest }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h3>
      <div className="grid divide-y">
        {pullRequest.activity.map((event) => (
          <div key={`${event.actor}:${event.detail}:${event.age}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-semibold text-foreground">{event.actor}</span>{" "}
              <span className="text-muted-foreground">{event.detail}</span>
            </span>
            <span className="text-xs text-muted-foreground">{event.age}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DescriptionPreview({ pullRequest }: { pullRequest: PrototypeQueuePullRequest }) {
  return (
    <div className="grid max-w-3xl gap-4">
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h3>
        <p className="text-sm leading-6 text-muted-foreground">{pullRequest.description}</p>
      </section>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labels</h3>
        <div className="flex flex-wrap gap-1.5">
          {pullRequest.labels.map((label) => (
            <span key={label} className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReadinessPill({ ready }: { ready: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-semibold",
        ready
          ? "border-primary/25 bg-primary/10 text-primary"
          : "border-anvil-attention/25 bg-anvil-attention/10 text-anvil-attention",
      )}
    >
      {ready ? "Ready to review" : "Reviewable with blockers"}
    </span>
  );
}

function StatusDot({ pullRequest }: { pullRequest: PrototypeQueuePullRequest }) {
  const hasFailing = pullRequest.checks.failing > 0;
  const hasPending = pullRequest.checks.pending > 0 || pullRequest.approvals.received < pullRequest.approvals.required;

  return (
    <span
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        hasFailing ? "bg-destructive" : hasPending ? "bg-anvil-attention" : "bg-primary",
      )}
    />
  );
}

function formatChecks(checks: PrototypeQueuePullRequest["checks"], total: number) {
  if (checks.failing > 0) return `${checks.failing} failing`;
  if (checks.pending > 0) return `${checks.pending} pending`;
  return `${checks.passing}/${total} passed`;
}

function formatApprovalFact(approvals: PrototypeQueuePullRequest["approvals"]) {
  if (approvals.required === 0) return "not required";
  return `${approvals.received}/${approvals.required} approved`;
}

function sizeInitial(size: PrototypeQueuePullRequest["estimatedReviewSize"]) {
  return size.slice(0, 1);
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

function getReadinessBlockers(pullRequest: PrototypeQueuePullRequest) {
  const blockers: string[] = [];
  if (pullRequest.checks.failing > 0) blockers.push(`${pullRequest.checks.failing} failing`);
  if (pullRequest.checks.pending > 0) blockers.push(`${pullRequest.checks.pending} pending`);
  const approvalsNeeded = Math.max(pullRequest.approvals.required - pullRequest.approvals.received, 0);
  if (approvalsNeeded > 0) blockers.push(`${approvalsNeeded} approval needed`);
  return blockers;
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 text-sm leading-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

export function PreparingReviewPrototype() {
  const [stateId, setStateId] = React.useState("evidence");
  const state =
    prototypePreparationStates.find((candidate) => candidate.id === stateId) ??
    prototypePreparationStates[0];
  const selected = prototypeQueuePullRequests[0];
  const phaseIndex = prototypePreparationPhases.findIndex((phase) => phase.id === state.activePhaseId);
  const completed = state.status === "ready" ? prototypePreparationPhases.length : Math.max(phaseIndex, 0);
  const progress = Math.round((completed / prototypePreparationPhases.length) * 100);
  const failed = state.status === "failed";

  return (
    <AppShell
      title="Building Review"
      eyebrow={`${selected.repo} #${selected.number}`}
      actions={
        <Button
          type="button"
          className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => navigatePrototype("review-queue")}
        >
          Cancel
        </Button>
      }
    >
      <section className="grid h-full min-h-0 place-items-center overflow-y-auto p-4 sm:p-6">
        <div className="grid w-full max-w-2xl gap-3">
          <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="grid gap-3 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProviderBadge provider={selected.provider} />
                    <Badge
                      className={cn(
                        failed
                          ? "border-destructive/25 bg-destructive/10 text-destructive"
                          : "border-primary/25 bg-primary/10 text-primary",
                      )}
                    >
                      {state.status}
                    </Badge>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold leading-tight">Building review for {selected.title}</h2>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {selected.repo} #{selected.number} by {selected.author}
                  </p>
                </div>
                {failed ? (
                  <CircleAlert className="size-5 text-destructive" />
                ) : state.status === "ready" ? (
                  <CheckCircle2 className="size-5 text-primary" />
                ) : (
                  <Loader2 className="size-5 animate-spin text-primary" />
                )}
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{state.message}</span>
                  <span className="font-mono tabular-nums">{progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full transition-[width]", failed ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>

            <ol className="grid gap-2 border-t p-4">
              {prototypePreparationPhases.map((phase) => {
                const phaseStatus = getPreparationPhaseStatus(phase.id, state);
                return <PreparationPhaseRow key={phase.id} phase={phase} status={phaseStatus} />;
              })}
            </ol>

            <details className="border-t bg-background/50">
              <summary className="cursor-pointer px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Diagnostics ({state.diagnostics.length})
              </summary>
              <ol className="grid gap-1 border-t px-5 py-3 font-mono text-xs text-muted-foreground">
                {state.diagnostics.map((line) => (
                  <li key={line} className="break-words">
                    {line}
                  </li>
                ))}
              </ol>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
              <span>The review opens when the first decisions are ready.</span>
              <Button
                type="button"
                className="h-8 border-border bg-background px-2 text-xs hover:bg-accent"
                onClick={() => navigatePrototype("decision-flow")}
              >
                Open decisions
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </section>

          <div className="flex flex-wrap justify-center gap-1.5">
            {prototypePreparationStates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={cn(
                  "h-7 rounded-md border px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                  candidate.id === state.id && "border-primary/35 bg-primary/10 text-primary",
                )}
                onClick={() => setStateId(candidate.id)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function PreparationPhaseRow({
  phase,
  status,
}: {
  phase: (typeof prototypePreparationPhases)[number];
  status: "pending" | "active" | "complete" | "failed";
}) {
  return (
    <li
      className={cn(
        "grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2",
        status === "active" && "border-primary/30 bg-primary/5",
        status === "failed" && "border-destructive/30 bg-destructive/10",
      )}
    >
      <span className="grid size-6 place-items-center">{PreparationPhaseIcon(status)}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{phase.label}</span>
        <span className="block text-xs leading-5 text-muted-foreground">{phase.detail}</span>
      </span>
      <span className="text-xs text-muted-foreground">{phaseStatusLabel(status)}</span>
    </li>
  );
}

function PreparationPhaseIcon(status: "pending" | "active" | "complete" | "failed") {
  if (status === "complete") return <CheckCircle2 className="size-4 text-primary" />;
  if (status === "failed") return <CircleAlert className="size-4 text-destructive" />;
  if (status === "active") return <Loader2 className="size-4 animate-spin text-primary" />;
  return <Circle className="size-4 text-muted-foreground" />;
}

function getPreparationPhaseStatus(phaseId: PrototypePreparationPhaseId, state: PrototypePreparationState) {
  const phaseIndex = prototypePreparationPhases.findIndex((phase) => phase.id === phaseId);
  const activeIndex = prototypePreparationPhases.findIndex((phase) => phase.id === state.activePhaseId);
  if (state.status === "ready") return "complete";
  if (state.status === "failed" && phaseId === state.activePhaseId) return "failed";
  if (phaseIndex < activeIndex) return "complete";
  if (phaseIndex === activeIndex && state.status !== "idle") return "active";
  return "pending";
}

function phaseStatusLabel(status: "pending" | "active" | "complete" | "failed") {
  if (status === "complete") return "done";
  if (status === "active") return "now";
  if (status === "failed") return "failed";
  return "next";
}

function ProviderBadge({ provider }: { provider: PrototypeQueuePullRequest["provider"] }) {
  return (
    <Badge
      className={cn(
        "h-6 shrink-0",
        provider === "Bitbucket"
          ? "border-anvil-info/20 bg-anvil-info/[0.06] text-anvil-info"
          : "border-foreground/15 bg-background text-foreground/75",
      )}
    >
      {provider}
    </Badge>
  );
}

function ProviderText({ provider }: { provider: PrototypeQueuePullRequest["provider"] }) {
  return (
    <span
      className={cn(
        "shrink-0 text-[11px] font-semibold uppercase tracking-wide",
        provider === "Bitbucket" ? "text-anvil-info" : "text-muted-foreground",
      )}
    >
      {provider}
    </span>
  );
}

function SizeBadge({ size }: { size: PrototypeQueuePullRequest["estimatedReviewSize"] }) {
  return (
    <Badge
      className={cn(
        "h-6 shrink-0",
        size === "Large" && "border-destructive/20 bg-destructive/[0.07] text-destructive",
        size === "Medium" && "border-anvil-attention/25 bg-anvil-attention/[0.08] text-anvil-attention",
        size === "Small" && "border-border bg-background text-muted-foreground",
      )}
    >
      {size}
    </Badge>
  );
}

function queueGroupIcon(queueState: PrototypeQueueState) {
  if (queueState === "created-by-me") return UserRound;
  if (queueState === "assigned-to-me") return UserCheck;
  if (queueState === "all-open") return ListFilter;
  return Inbox;
}

function navigatePrototype(prototype: "review-queue" | "preparing-review" | "decision-flow") {
  if (typeof window === "undefined") return;
  window.location.href = `${window.location.pathname}?prototype=${prototype}`;
}

export function ExperiencePrototype() {
  const [activeId, setActiveId] = React.useState(prototypeSlices[0]?.id ?? "");
  const [decisions, setDecisions] = React.useState<SliceDecisionMap>(initialDecisions);
  const [drafts, setDrafts] = React.useState<DraftMap>(initialDrafts);
  const [preferredAgent, setPreferredAgent] = React.useState<PreferredAgent>("codex");
  const [reviewDisposition, setReviewDisposition] = React.useState<ReviewDisposition>("request-changes");
  const [viewMode, setViewMode] = React.useState<"decision" | "summary">("decision");
  const active = prototypeSlices.find((slice) => slice.id === activeId) ?? prototypeSlices[0];
  const activeStatus = decisions[active.id] ?? active.status;
  const queuedSlices = prototypeSlices.filter((slice) => decisions[slice.id] === "queued");
  const handledSlices = prototypeSlices.filter(
    (slice) => decisions[slice.id] === "safe" || decisions[slice.id] === "fixed",
  );
  const deferredSlices = prototypeSlices.filter((slice) => decisions[slice.id] === "deferred");
  const unresolvedSlices = prototypeSlices.filter((slice) => decisions[slice.id] === "unresolved");
  const readyToPreview = unresolvedSlices.length === 0;
  const showingSummary = readyToPreview && viewMode === "summary";

  const askAgent = () => {};
  const selectDecision = React.useCallback((sliceId: string) => {
    setActiveId(sliceId);
    setViewMode("decision");
  }, []);
  const selectNextDecision = React.useCallback(
    (currentId: string, nextDecisions: SliceDecisionMap = decisions) => {
      setActiveId(nextDecisionId(currentId, nextDecisions));
    },
    [decisions],
  );
  const handleDecision = React.useCallback(
    (sliceId: string, status: PrototypeSliceStatus) => {
      const nextDecisions = { ...decisions, [sliceId]: status };
      setDecisions(nextDecisions);
      selectNextDecision(sliceId, nextDecisions);
      if (prototypeSlices.every((slice) => nextDecisions[slice.id] !== "unresolved")) {
        setViewMode("summary");
      }
    },
    [decisions, selectNextDecision],
  );

  return (
    <AppShell
      title="Decision-first prototype"
      eyebrow={`${prototypePullRequest.repo} #${prototypePullRequest.number}`}
      actions={
        <>
          <Button
            type="button"
            className="h-8 border-[#315f7d]/25 bg-[#315f7d]/5 px-2 text-xs text-[#234b65] hover:bg-[#315f7d]/10"
          >
            <GitPullRequest className="size-3.5 text-[#315f7d]" />
            Open in Bitbucket
          </Button>
          <Button type="button" className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Settings className="size-3.5" />
            Settings
          </Button>
        </>
      }
    >
      <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
        <main className="min-h-0 overflow-y-auto p-5">
          {showingSummary ? (
            <SubmissionPreviewMain
              queuedSlices={queuedSlices}
              handledSlices={handledSlices}
              deferredSlices={deferredSlices}
              drafts={drafts}
              disposition={reviewDisposition}
              onDispositionChange={setReviewDisposition}
              onOpenSlice={selectDecision}
            />
          ) : (
            <DecisionStage
              active={active}
              draft={drafts[active.id] ?? active.commentDraft ?? ""}
              status={activeStatus}
              preferredAgent={preferredAgent}
              onAskAgent={askAgent}
              onPreferredAgentChange={setPreferredAgent}
              onDraftChange={(draft) => setDrafts((current) => ({ ...current, [active.id]: draft }))}
              onDecision={(status) => handleDecision(active.id, status)}
            />
          )}
        </main>

        <aside className="min-h-0 overflow-y-auto border-l bg-background p-3">
          <LedgerPanel
            queuedSlices={queuedSlices}
            handledSlices={handledSlices}
            deferredSlices={deferredSlices}
            unresolvedSlices={unresolvedSlices}
            readyToPreview={readyToPreview}
            summaryActive={showingSummary}
            activeId={active.id}
            onSelectSummary={() => setViewMode("summary")}
            onSelect={selectDecision}
          />
        </aside>
      </section>
    </AppShell>
  );
}

function DecisionStage({
  active,
  draft,
  status,
  preferredAgent,
  onAskAgent,
  onPreferredAgentChange,
  onDraftChange,
  onDecision,
}: {
  active: PrototypeSlice;
  draft: string;
  status: PrototypeSliceStatus;
  preferredAgent: PreferredAgent;
  onAskAgent: () => void;
  onPreferredAgentChange: (agent: PreferredAgent) => void;
  onDraftChange: (draft: string) => void;
  onDecision: (status: PrototypeSliceStatus) => void;
}) {
  const hasCommentAction = Boolean(active.commentDraft);
  const canUseDraft = draft.trim().length > 0;
  const primaryLabel = hasCommentAction ? "Comment on PR" : "Looks safe";
  const primaryStatus: PrototypeSliceStatus = active.commentDraft ? "queued" : "safe";
  const inlineDraftLine = getInlineDraftLine(active);
  const hasNewInlineDraftLine = active.diff.lines.some(
    (line) => line.newNumber === inlineDraftLine && line.kind !== "remove",
  );

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge risk={active.risk} />
              <StatusBadge status={status} />
              <span className="text-xs text-muted-foreground">
                {active.files.length} file{active.files.length === 1 ? "" : "s"}
              </span>
            </div>
            <h2 className="mt-2 max-w-4xl text-xl font-semibold leading-tight">{active.decision}</h2>
            <p className="mt-1.5 max-w-4xl text-sm leading-6 text-muted-foreground">{active.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className={hasCommentAction ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-border bg-background"}
                onClick={() => onDecision(primaryStatus)}
                disabled={hasCommentAction && !canUseDraft}
              >
                {hasCommentAction ? <MessageSquarePlus className="size-4" /> : <CheckCircle2 className="size-4" />}
                {primaryLabel}
              </Button>
              {hasCommentAction ? (
                <Button type="button" className="border-border bg-background" onClick={() => onDecision("safe")}>
                  <CheckCircle2 className="size-4" />
                  Looks safe
                </Button>
              ) : null}
              <Button type="button" className="border-border bg-background" onClick={() => onDecision("deferred")}>
                <CircleAlert className="size-4" />
                Defer
              </Button>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {active.investigation ? (
              <AskAgentButton
                preferredAgent={preferredAgent}
                onAsk={onAskAgent}
                onPreferredAgentChange={onPreferredAgentChange}
              />
            ) : null}
          </div>
        </div>

      </section>

      <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Eye className="size-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inspect evidence</h3>
          </div>
          <span className="truncate font-mono text-xs text-muted-foreground">{active.diff.file}</span>
        </div>

        <div className="overflow-x-auto">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <FileCode2 className="size-4 text-primary" />
              <span className="truncate font-mono text-xs">{active.diff.file}</span>
            </div>
            <span className="text-xs text-muted-foreground">{active.diff.hunk}</span>
          </div>
          {active.diff.lines.map((line, index) => (
            <React.Fragment key={`${active.id}:${index}`}>
              <div
                className={cn(
                  "grid min-w-full grid-cols-[48px_48px_24px_minmax(44rem,1fr)] font-mono text-xs leading-7",
                  line.kind === "add" && "bg-anvil-diff-add",
                  line.kind === "remove" && "bg-anvil-diff-remove",
                )}
              >
                <span className="select-none pr-2 text-right text-muted-foreground">{line.oldNumber ?? ""}</span>
                <span className="select-none pr-2 text-right text-muted-foreground">{line.newNumber ?? ""}</span>
                <span
                  className={cn(
                    "select-none text-center",
                    line.kind === "add" && "text-anvil-success",
                    line.kind === "remove" && "text-destructive",
                  )}
                >
                  {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                </span>
                <code className="whitespace-pre text-anvil-code">{line.text}</code>
              </div>
              {hasCommentAction && shouldRenderInlineDraft(line, inlineDraftLine, hasNewInlineDraftLine) ? (
                <InlineDraftComment draft={draft} onDraftChange={onDraftChange} />
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}

function AskAgentButton({
  preferredAgent,
  onAsk,
  onPreferredAgentChange,
}: {
  preferredAgent: PreferredAgent;
  onAsk: () => void;
  onPreferredAgentChange: (agent: PreferredAgent) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const label = preferredAgent === "codex" ? "Codex" : "Claude";
  const selectAgent = (agent: PreferredAgent) => {
    onPreferredAgentChange(agent);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <div className="inline-flex h-8 overflow-hidden rounded-md border bg-card shadow-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 text-xs font-medium text-foreground hover:bg-accent"
          onClick={onAsk}
        >
          <Bot className="size-3.5 text-anvil-info" />
          Ask {label}
        </button>
        <button
          type="button"
          className="grid w-8 place-items-center border-l text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label="Choose agent"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </div>
      {open ? (
        <div className="absolute right-0 top-9 z-10 w-40 rounded-md border bg-card p-1 shadow-lg">
          <AgentOption
            agent="codex"
            label="Codex"
            selected={preferredAgent === "codex"}
            onSelect={selectAgent}
          />
          <AgentOption
            agent="claude"
            label="Claude"
            selected={preferredAgent === "claude"}
            onSelect={selectAgent}
          />
        </div>
      ) : null}
    </div>
  );
}

function AgentOption({
  agent,
  label,
  selected,
  onSelect,
}: {
  agent: PreferredAgent;
  label: string;
  selected: boolean;
  onSelect: (agent: PreferredAgent) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
        selected && "bg-anvil-info/10 text-anvil-info",
      )}
      onClick={() => onSelect(agent)}
    >
      <span>{label}</span>
      {selected ? <CheckCircle2 className="size-3.5" /> : null}
    </button>
  );
}

function InlineDraftComment({
  draft,
  onDraftChange,
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
}) {
  return (
    <div className="grid min-w-full grid-cols-[48px_48px_24px_minmax(0,1fr)] bg-anvil-diff-add py-2 text-left text-xs leading-5">
      <span />
      <span />
      <span className="relative">
        <span className="absolute left-1/2 top-3 grid size-4 -translate-x-1/2 place-items-center rounded-full bg-anvil-info text-[10px] text-white">
          +
        </span>
      </span>
      <div className="mr-3 rounded-md border bg-card px-3 py-2 shadow-none">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-anvil-info/10 text-[11px] font-semibold text-anvil-info">
              A
            </span>
            <div className="min-w-0 truncate text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Anvil</span>
              <span className="mx-1">·</span>
              <span>Recommended draft</span>
            </div>
          </div>
          <span className="text-xs font-medium text-anvil-info">Edit draft</span>
        </div>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="ml-9 min-h-16 w-[calc(100%-2.25rem)] resize-y rounded-md border border-input/70 bg-background/70 px-2.5 py-2 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-input hover:bg-background focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/25"
        />
      </div>
    </div>
  );
}

function getInlineDraftLine(slice: PrototypeSlice) {
  const matchingEvidence = slice.evidence.find((item) => item.file === slice.diff.file);
  return matchingEvidence?.line;
}

function shouldRenderInlineDraft(
  line: PrototypeSlice["diff"]["lines"][number],
  targetLine: number | undefined,
  hasNewTargetLine: boolean,
) {
  if (!targetLine) return false;
  if (line.newNumber === targetLine && line.kind !== "remove") return true;
  return !hasNewTargetLine && line.newNumber === null && line.oldNumber === targetLine;
}

function RiskDot({ risk }: { risk: PrototypeSlice["risk"] }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        risk === "high" && "bg-destructive",
        risk === "medium" && "bg-anvil-attention",
        risk === "low" && "bg-anvil-info",
      )}
    />
  );
}

function RiskBadge({ risk }: { risk: PrototypeSlice["risk"] }) {
  return (
    <Badge
      className={cn(
        risk === "high" && "border-destructive/25 bg-destructive/10 text-destructive",
        risk === "medium" && "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
        risk === "low" && "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
      )}
    >
      {risk} risk
    </Badge>
  );
}

function StatusBadge({ status }: { status: PrototypeSliceStatus }) {
  const labels: Record<PrototypeSliceStatus, string> = {
    unresolved: "needs decision",
    queued: "draft selected",
    safe: "looks safe",
    fixed: "fixed locally",
    deferred: "deferred",
  };

  return (
    <Badge
      className={cn(
        "shrink-0",
        status === "unresolved" && "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
        status === "queued" && "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
        (status === "safe" || status === "fixed") && "border-anvil-success/25 bg-anvil-success/10 text-anvil-success",
        status === "deferred" && "border-border bg-background text-muted-foreground",
      )}
    >
      {labels[status]}
    </Badge>
  );
}

function LedgerPanel({
  queuedSlices,
  handledSlices,
  deferredSlices,
  unresolvedSlices,
  readyToPreview,
  summaryActive,
  activeId,
  onSelectSummary,
  onSelect,
}: {
  queuedSlices: PrototypeSlice[];
  handledSlices: PrototypeSlice[];
  deferredSlices: PrototypeSlice[];
  unresolvedSlices: PrototypeSlice[];
  readyToPreview: boolean;
  summaryActive: boolean;
  activeId: string;
  onSelectSummary: () => void;
  onSelect: (sliceId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <DecisionTasks
        queuedSlices={queuedSlices}
        handledSlices={handledSlices}
        unresolvedSlices={unresolvedSlices}
        deferredSlices={deferredSlices}
        activeId={activeId}
        onSelect={onSelect}
      />

      <PrOutcomeCard
        queuedCount={queuedSlices.length}
        unresolvedCount={unresolvedSlices.length}
        readyToPreview={readyToPreview}
        active={summaryActive}
        onSelect={onSelectSummary}
      />

    </div>
  );
}

function PrOutcomeCard({
  queuedCount,
  unresolvedCount,
  readyToPreview,
  active,
  onSelect,
}: {
  queuedCount: number;
  unresolvedCount: number;
  readyToPreview: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review packet</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {queuedCount > 0
              ? `${queuedCount} comment${queuedCount === 1 ? "" : "s"} staged for Bitbucket.`
              : "No comments staged yet."}
          </p>
        </div>
        <Badge
          className={
            readyToPreview
              ? "border-anvil-success/25 bg-anvil-success/10 text-anvil-success"
              : "border-border bg-background text-muted-foreground"
          }
        >
          {readyToPreview ? "ready" : "not ready"}
        </Badge>
      </div>
      {!readyToPreview ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Resolve {unresolvedCount} open decision{unresolvedCount === 1 ? "" : "s"} to build the submission packet.
        </p>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Review staged comments before submitting.
        </p>
      )}
    </>
  );

  if (readyToPreview) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:bg-accent",
          active && "border-primary/25 bg-primary/5 shadow-md hover:bg-primary/5",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <section className="rounded-md border border-transparent px-2 py-2">
      {content}
    </section>
  );
}

function DecisionTasks({
  queuedSlices,
  handledSlices,
  unresolvedSlices,
  deferredSlices,
  activeId,
  onSelect,
}: {
  queuedSlices: PrototypeSlice[];
  handledSlices: PrototypeSlice[];
  unresolvedSlices: PrototypeSlice[];
  deferredSlices: PrototypeSlice[];
  activeId: string;
  onSelect: (sliceId: string) => void;
}) {
  const rows: Array<{ slice: PrototypeSlice; title: string; detail: string; status: "done" | "active" | "idle" | "deferred" }> = [
    ...queuedSlices.map((slice) => ({ slice, title: slice.title, detail: "Comment selected", status: "done" as const })),
    ...handledSlices.map((slice) => ({ slice, title: slice.title, detail: "Handled locally", status: "done" as const })),
    ...unresolvedSlices.map((slice, index) => ({
      slice,
      title: slice.decision,
      detail: slice.id === activeId ? "Current decision" : index === 0 ? "Next blocker" : "Needs decision",
      status: slice.id === activeId ? ("active" as const) : ("idle" as const),
    })),
    ...deferredSlices.map((slice) => ({ slice, title: slice.title, detail: "Deferred", status: "deferred" as const })),
  ];

  return (
    <section className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisions</h3>
        <Badge>{rows.length}</Badge>
      </div>
      <ol className="grid gap-2">
        {rows.map((row) => (
          <button
            key={`${row.slice.id}:${row.detail}`}
            type="button"
            onClick={() => onSelect(row.slice.id)}
            className={cn(
              "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
              row.status === "active" && "bg-anvil-info/10 hover:bg-anvil-info/10",
            )}
          >
            <span
              className={cn(
                "mt-0.5 grid size-5 place-items-center rounded-full border text-[10px]",
                row.status === "done" && "border-anvil-success/25 bg-anvil-success/10 text-anvil-success",
                row.status === "active" && "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
                row.status === "idle" && "border-border bg-background text-muted-foreground",
                row.status === "deferred" && "border-border bg-muted text-muted-foreground",
              )}
            >
              {row.status === "done" ? <CheckCircle2 className="size-3.5" /> : null}
              {row.status === "deferred" ? <Minus className="size-3.5" /> : null}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-sm leading-5", (row.status === "done" || row.status === "deferred") && "text-muted-foreground")}>
                {row.title}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{row.detail}</span>
            </span>
          </button>
        ))}
      </ol>
    </section>
  );
}

function SubmissionPreviewMain({
  queuedSlices,
  handledSlices,
  deferredSlices,
  drafts,
  disposition,
  onDispositionChange,
  onOpenSlice,
}: {
  queuedSlices: PrototypeSlice[];
  handledSlices: PrototypeSlice[];
  deferredSlices: PrototypeSlice[];
  drafts: DraftMap;
  disposition: ReviewDisposition;
  onDispositionChange: (disposition: ReviewDisposition) => void;
  onOpenSlice: (sliceId: string) => void;
}) {
  const localOnlySlices = [...handledSlices, ...deferredSlices];
  const providerAction =
    queuedSlices.length > 0
      ? `${queuedSlices.length} comment${queuedSlices.length === 1 ? "" : "s"} to Bitbucket`
      : "Approve without comments";

  return (
    <section className="mx-auto max-w-5xl">
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="border-l-4 border-l-primary px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-anvil-success/25 bg-anvil-success/10 text-anvil-success">ready</Badge>
                <span className="text-xs text-muted-foreground">{providerAction}</span>
              </div>
              <h2 className="mt-2 text-2xl font-semibold leading-tight">Submit review</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                Final provider packet for this pull request.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" className="border-border bg-background">
                <ShieldCheck className="size-4" />
                Approve PR
              </Button>
              <ReviewDispositionButton disposition={disposition} onDispositionChange={onDispositionChange} />
            </div>
          </div>
        </div>

        <div className="border-t bg-anvil-info/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground">
            <span>{queuedSlices.length} comment{queuedSlices.length === 1 ? "" : "s"} ready for Bitbucket</span>
            <span>{localOnlySlices.length} kept local</span>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4">
          <SectionHeader title="Comments to post" count={queuedSlices.length} />
          {queuedSlices.length > 0 ? (
            <div className="grid gap-3">
              {queuedSlices.map((slice) => (
                <PreviewComment
                  key={slice.id}
                  slice={slice}
                  draft={drafts[slice.id] ?? slice.commentDraft ?? ""}
                  onOpen={() => onOpenSlice(slice.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No comments will be posted.</p>
          )}
        </div>

        <div className="border-t bg-background/50 px-4 py-3">
          <SectionHeader title="Kept local" count={localOnlySlices.length} />
          {localOnlySlices.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {localOnlySlices.map((slice) => (
                <li key={slice.id} className="flex items-center justify-between gap-3 text-sm leading-5 text-muted-foreground">
                  <span>{slice.title}</span>
                  <span className="shrink-0 text-xs">
                    {deferredSlices.some((deferred) => deferred.id === slice.id) ? "Deferred" : "Looks safe"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No local-only decisions.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ReviewDispositionButton({
  disposition,
  onDispositionChange,
}: {
  disposition: ReviewDisposition;
  onDispositionChange: (disposition: ReviewDisposition) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const label = disposition === "request-changes" ? "Request changes" : "Submit comments";
  const selectDisposition = (nextDisposition: ReviewDisposition) => {
    onDispositionChange(nextDisposition);
    setOpen(false);
  };

  return (
    <div className="relative inline-flex">
      <div className="inline-flex h-9 overflow-hidden rounded-md shadow-sm">
        <button
          type="button"
          className="bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {label}
        </button>
        <button
          type="button"
          className="grid w-8 place-items-center border-l border-primary-foreground/25 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label="Choose review disposition"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      {open ? (
        <div className="absolute right-0 top-10 z-10 w-44 rounded-md border bg-card p-1 shadow-lg">
          <ReviewDispositionOption
            disposition="request-changes"
            label="Request changes"
            selected={disposition === "request-changes"}
            onSelect={selectDisposition}
          />
          <ReviewDispositionOption
            disposition="comment"
            label="Submit comments"
            selected={disposition === "comment"}
            onSelect={selectDisposition}
          />
        </div>
      ) : null}
    </div>
  );
}

function ReviewDispositionOption({
  disposition,
  label,
  selected,
  onSelect,
}: {
  disposition: ReviewDisposition;
  label: string;
  selected: boolean;
  onSelect: (disposition: ReviewDisposition) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
        selected && "bg-primary/10 text-primary",
      )}
      onClick={() => onSelect(disposition)}
    >
      <span>{label}</span>
      {selected ? <CheckCircle2 className="size-3.5" /> : null}
    </button>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <Badge>{count}</Badge>
    </div>
  );
}

function PreviewComment({ slice, draft, onOpen }: { slice: PrototypeSlice; draft: string; onOpen: () => void }) {
  const anchor = slice.evidence[0];
  return (
    <button type="button" className="rounded-md border bg-card text-left transition-colors hover:bg-accent/40" onClick={onOpen}>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 px-3 py-3">
        <span className="grid size-7 place-items-center rounded-full bg-anvil-info/10 text-[11px] font-semibold text-anvil-info">
          {providerAuthor.initials}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-foreground">{providerAuthor.name}</span>
            <span className="text-xs text-muted-foreground">will comment</span>
            {anchor ? (
              <span className="font-mono text-xs text-muted-foreground">
                {anchor.file}:{anchor.line}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">{slice.title}</div>
          <p className="mt-2 text-sm leading-6 text-foreground">{draft}</p>
        </div>
      </div>
    </button>
  );
}

function LedgerSection({
  icon: Icon,
  title,
  items,
  empty,
}: {
  icon: typeof MessageSquarePlus;
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4" />
        {title}
        <Badge className="ml-auto h-5 px-1.5 text-[10px]">{items.length}</Badge>
      </div>
      {items.length > 0 ? (
        <ul className="grid gap-1.5">
          {items.map((item) => (
            <li key={item} className="rounded-md border bg-background px-2 py-1.5 text-xs leading-5">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function nextDecisionId(currentId: string, decisions: SliceDecisionMap) {
  const index = prototypeSlices.findIndex((slice) => slice.id === currentId);
  const orderedSlices = [...prototypeSlices.slice(index + 1), ...prototypeSlices.slice(0, Math.max(index, 0))];
  return orderedSlices.find((slice) => decisions[slice.id] === "unresolved")?.id ?? currentId;
}
