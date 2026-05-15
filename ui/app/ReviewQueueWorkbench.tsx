import * as React from "react";
import {
  Check,
  Cloud,
  Filter,
  GitPullRequest,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/app/AppShell";
import { parseManualPullRequestUrl } from "@/app/LauncherScreen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ManualPullRequestDialog } from "./review-queue/ManualPullRequestDialog";
import {
  filterForGroup,
  normalizeQueuePullRequest,
  queueGroups,
  queueRowInGroup,
  sourceId,
  sourceName,
} from "./review-queue/model";
import { QueueEmptyState } from "./review-queue/QueueEmptyState";
import { QueueGroup } from "./review-queue/QueueGroup";
import { QueueNoSelection, QueuePreview } from "./review-queue/QueuePreview";
import type { ReviewQueueWorkbenchProps } from "./review-queue/types";

export function ReviewQueueWorkbench({
  pullRequests,
  selectedRowId,
  activeFilter = "allOpen",
  sourceFilter = "all",
  searchQuery,
  loading,
  refreshing,
  selectedDetailsLoading = false,
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
}: ReviewQueueWorkbenchProps) {
  const [sourceMenuOpen, setSourceMenuOpen] = React.useState(false);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualUrl, setManualUrl] = React.useState("");
  const [manualError, setManualError] = React.useState<string | undefined>();
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const rows = React.useMemo(() => pullRequests.map(normalizeQueuePullRequest), [pullRequests]);
  const sourceCounts = React.useMemo(() => countQueueSources(rows), [rows]);
  const sourceFilteredRows = rows.filter((row) => sourceFilter === "all" || row.source === sourceFilter);
  const filteredRows = sourceFilteredRows.filter((row) => {
    if (!normalizedQuery) return true;
    return [row.title, row.repoName, row.repo, row.providerSource, row.author, row.number]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const selected = filteredRows.find((row) => row.id === selectedRowId) ?? rows.find((row) => row.id === selectedRowId);
  const isFetching = loading || refreshing;
  const activeSourceLabel =
    sourceFilter === "github" ? "GitHub" : sourceFilter === "bitbucket" ? "Bitbucket" : "All sources";
  const activeSourceCount =
    sourceFilter === "github"
      ? sourceCounts.github
      : sourceFilter === "bitbucket"
        ? sourceCounts.bitbucket
        : rows.length;

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
      title="Anvil"
      subtitle="PR review workbench"
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
      <section
        className="grid h-full min-h-0 grid-cols-[minmax(320px,420px)_minmax(0,1fr)] overflow-hidden"
        data-testid="review-inbox"
      >
        <aside className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] border-r bg-card">
          <div className="grid gap-3 border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <GitPullRequest className="size-4 text-primary" />
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">Review Queue</h2>
                <p className="truncate text-xs text-muted-foreground">Pick the next PR for Anvil to prepare.</p>
              </div>
              <Badge className="ml-auto h-7 border-transparent bg-muted px-2 font-mono text-xs text-muted-foreground">
                {sourceFilteredRows.length} PRs
              </Badge>
            </div>
            {isFetching ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span data-testid="review-inbox-status">Loading</span>
              </div>
            ) : (
              <span data-testid="review-inbox-status" className="sr-only">
                Loaded
              </span>
            )}
          </div>

          <div className="border-b px-5 py-3">
            <div className="relative flex min-w-0 items-center gap-2">
              <label className="relative block min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                  placeholder="Search title, repo, author, number"
                  className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                />
              </label>
              <button
                type="button"
                className={[
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                  sourceFilter === "all"
                    ? "border-border bg-background text-muted-foreground hover:bg-accent"
                    : "border-primary/35 bg-primary/10 text-foreground hover:bg-primary/15",
                ].join(" ")}
                aria-label={`Filter PR sources: ${activeSourceLabel}, ${activeSourceCount}`}
                aria-haspopup="menu"
                aria-expanded={sourceMenuOpen}
                onClick={() => setSourceMenuOpen((open) => !open)}
              >
                <Filter className="size-4" />
                <span className="font-mono">{activeSourceCount}</span>
              </button>
              {sourceMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-11 z-20 w-48 overflow-hidden rounded-md border bg-popover p-1 text-sm shadow-lg"
                  data-testid="source-filter-menu"
                >
                  <SourceFilterMenuItem
                    label="All sources"
                    selected={sourceFilter === "all"}
                    count={rows.length}
                    onClick={() => {
                      onSourceFilterChange("all");
                      setSourceMenuOpen(false);
                    }}
                  />
                  <SourceFilterMenuItem
                    label="GitHub"
                    icon={GitPullRequest}
                    selected={sourceFilter === "github"}
                    count={sourceCounts.github}
                    onClick={() => {
                      onSourceFilterChange("github");
                      setSourceMenuOpen(false);
                    }}
                  />
                  <SourceFilterMenuItem
                    label="Bitbucket"
                    icon={Cloud}
                    selected={sourceFilter === "bitbucket"}
                    count={sourceCounts.bitbucket}
                    onClick={() => {
                      onSourceFilterChange("bitbucket");
                      setSourceMenuOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto" data-testid="pull-request-list">
            {filteredRows.length > 0 ? (
              <div className="grid">
                {queueGroups.map((group) => {
                  const groupRows = filteredRows.filter((row) => queueRowInGroup(row, group.id));
                  return (
                    <QueueGroup
                      key={group.id}
                      group={group}
                      rows={groupRows}
                      selectedId={selected?.id}
                      active={activeFilter === filterForGroup(group.id)}
                      onActivate={() => onActiveFilterChange(filterForGroup(group.id))}
                      onSelect={(pullRequest) => onSelectRow(pullRequest.raw)}
                    />
                  );
                })}
              </div>
            ) : isFetching ? (
              <QueueEmptyState
                icon={<Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />}
                title="Loading PRs"
                detail="Anvil is fetching open pull requests from your review sources."
              />
            ) : (
              <QueueEmptyState
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

        <main className="relative min-h-0 overflow-hidden bg-background">
          {isFetching ? <InboxProgressStrip /> : null}
          {selected ? (
            <QueuePreview
              pullRequest={selected}
              detailsLoading={selectedDetailsLoading}
              onPrepare={() => onPrepare(selected.raw)}
              onOpenProvider={() => onOpenProvider(selected.raw)}
            />
          ) : (
            <QueueNoSelection loading={isFetching} />
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

function InboxProgressStrip() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-primary/10">
      <div className="anvil-progress-strip h-full w-1/3 rounded-r-full bg-primary/60" />
    </div>
  );
}

function countQueueSources(rows: Array<{ source: string }>) {
  return {
    github: rows.filter((row) => sourceId(row.source) === "github").length,
    bitbucket: rows.filter((row) => sourceId(row.source) === "bitbucket").length,
  };
}

function SourceFilterMenuItem({
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
      role="menuitemradio"
      aria-checked={selected}
      className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-muted-foreground">{count}</span>
      {selected ? <Check className="size-3.5 shrink-0 text-primary" /> : <span className="size-3.5 shrink-0" />}
    </button>
  );
}
