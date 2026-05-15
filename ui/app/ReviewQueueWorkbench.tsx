import * as React from "react";
import { Cloud, GitPullRequest, Inbox, Loader2, RefreshCw, Search, Settings } from "lucide-react";

import { AppShell } from "@/app/AppShell";
import { parseManualPullRequestUrl } from "@/app/LauncherScreen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ManualPullRequestDialog } from "./review-queue/ManualPullRequestDialog";
import {
  countSources,
  filterForGroup,
  matchesSource,
  normalizeQueuePullRequest,
  queueGroups,
  queueRowInGroup,
  sourceName,
} from "./review-queue/model";
import { QueueEmptyState } from "./review-queue/QueueEmptyState";
import { QueueGroup } from "./review-queue/QueueGroup";
import { QueueNoSelection, QueuePreview } from "./review-queue/QueuePreview";
import { SourceFilterButton } from "./review-queue/SourceFilterButton";
import type { ReviewQueueWorkbenchProps } from "./review-queue/types";

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
}: ReviewQueueWorkbenchProps) {
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualUrl, setManualUrl] = React.useState("");
  const [manualError, setManualError] = React.useState<string | undefined>();
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const rows = React.useMemo(() => pullRequests.map(normalizeQueuePullRequest), [pullRequests]);
  const sourceFilteredRows = rows.filter((row) => matchesSource(row, sourceFilter));
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
  const sourceCounts = countSources(rows);
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
              <SourceFilterButton
                label="All sources"
                selected={sourceFilter === "all"}
                count={rows.length}
                onClick={() => onSourceFilterChange("all")}
              />
              <SourceFilterButton
                label="GitHub"
                icon={GitPullRequest}
                selected={sourceFilter === "github"}
                count={sourceCounts.github}
                onClick={() => onSourceFilterChange("github")}
              />
              <SourceFilterButton
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
                detail="Fetching open pull requests from your review sources."
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

        <main className="min-h-0 overflow-hidden bg-background">
          {selected ? (
            <QueuePreview
              pullRequest={selected}
              onPrepare={() => onPrepare(selected.raw)}
              onOpenProvider={() => onOpenProvider(selected.raw)}
            />
          ) : (
            <QueueNoSelection />
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
