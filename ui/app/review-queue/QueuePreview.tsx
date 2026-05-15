import * as React from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  ExternalLink,
  FileCode2,
  GitCommit,
  GitPullRequest,
  ListTodo,
  MessageSquare,
  Minus,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { initialsFor, providerIcon, providerIconTone } from "./format";
import { QueueStatusPill } from "./StatusPill";
import type { QueuePullRequest } from "./types";

type PreviewFile = {
  path: string;
  additions: number;
  deletions: number;
};

type PreviewFileGroup = {
  label: string;
  files: PreviewFile[];
};

type PreviewActivity = {
  actor: string;
  detail: string;
  age: string;
};

type PreviewMetadata = {
  changedFilesCount: number;
  commitsCount: number;
  commentsCount: number;
  tasksCount: number;
  additionsCount: number;
  deletionsCount: number;
  checks: {
    passing: number;
    failing: number;
    pending: number;
  };
  approvals: {
    received: number;
    required: number;
  };
  requestedReviewers: string[];
  description: string;
  labels: string[];
  changedFileGroups: PreviewFileGroup[];
  activity: PreviewActivity[];
};

type QueuePreviewProps = {
  pullRequest: QueuePullRequest;
  detailsLoading?: boolean;
  onPrepare: () => void;
  onOpenProvider: () => void;
};

export function QueuePreview({
  pullRequest,
  detailsLoading = false,
  onPrepare,
  onOpenProvider,
}: QueuePreviewProps) {
  const [activeTab, setActiveTab] = React.useState<"files" | "description" | "activity">("files");
  const ProviderIcon = providerIcon(pullRequest.provider);
  const metadata = React.useMemo(() => buildPreviewMetadata(pullRequest), [pullRequest]);
  const totalChecks = metadata.checks.passing + metadata.checks.failing + metadata.checks.pending;

  return (
    <aside className="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <div className="border-b bg-card px-6 py-4">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(12rem,24rem)] items-start gap-5">
          <div className="min-w-0 max-w-3xl">
            <QueueStatusPill status={pullRequest.status} />
            <a
              href={pullRequest.url}
              className="mt-3 flex w-fit max-w-full items-center gap-1.5 text-lg font-semibold leading-6 text-foreground underline-offset-4 hover:text-primary hover:underline"
              onClick={(event) => {
                event.preventDefault();
                onOpenProvider();
              }}
            >
              <span className="truncate" data-testid="review-preview-title">
                {pullRequest.title}
              </span>
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
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Opened {pullRequest.age}
              {pullRequest.cacheStatus === "stale" ? " · stale cache" : pullRequest.cacheStatus === "cached" ? " · cached" : ""}
            </div>
          </div>
          <PullRequestStats pullRequest={pullRequest} metadata={metadata} loading={detailsLoading} />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <ProviderStatusStrip metadata={metadata} totalChecks={totalChecks} loading={detailsLoading} />

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
              {detailsLoading ? "Files" : `Files (${metadata.changedFilesCount})`}
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
              Activity ({metadata.activity.length})
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {detailsLoading ? (
            <PreviewGhost activeTab={activeTab} />
          ) : activeTab === "files" ? (
            <ChangedFilesMap metadata={metadata} />
          ) : activeTab === "description" ? (
            <DescriptionPreview metadata={metadata} />
          ) : (
            <ActivityPreview metadata={metadata} />
          )}
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

export function QueueNoSelection() {
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

function PullRequestStats({
  pullRequest,
  metadata,
  loading,
}: {
  pullRequest: QueuePullRequest;
  metadata: PreviewMetadata;
  loading: boolean;
}) {
  const hasBranchRoute = Boolean(pullRequest.sourceBranch || pullRequest.targetBranch);

  if (loading) {
    return (
      <div className="grid min-w-0 justify-items-end gap-3 text-sm">
        <div className="flex items-center gap-3">
          <GhostLine className="h-4 w-16" />
          <GhostLine className="h-4 w-10" />
          <GhostLine className="h-4 w-10" />
        </div>
        <GhostLine className="h-4 w-24" />
        {hasBranchRoute ? <GhostLine className="h-4 w-full max-w-72" /> : null}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 justify-items-end gap-2 text-sm text-muted-foreground">
      <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5">
          <FileCode2 className="size-3.5" />
          <span className="font-semibold text-foreground">{sizeInitial(metadata.changedFilesCount)}</span>
          <span>{metadata.changedFilesCount} files</span>
        </span>
        <span className="flex items-center gap-1.5">
          <GitCommit className="size-3.5" />
          {metadata.commitsCount}
        </span>
        <span className="flex items-center gap-1.5">
          <MessageSquare className="size-3.5" />
          {metadata.commentsCount}
        </span>
        {metadata.tasksCount > 0 ? (
          <span className="flex items-center gap-1.5">
            <ListTodo className="size-3.5" />
            {metadata.tasksCount}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 font-mono">
        <span className="flex items-center gap-1 text-primary">
          <Plus className="size-3.5" />
          {metadata.additionsCount}
        </span>
        <span className="flex items-center gap-1 text-destructive">
          <Minus className="size-3.5" />
          {metadata.deletionsCount}
        </span>
      </div>
      {hasBranchRoute ? (
        <div className="flex min-w-0 max-w-full items-center gap-2 font-mono text-muted-foreground">
          <span className="truncate">{pullRequest.sourceBranch ?? "head"}</span>
          <ArrowRight className="size-3.5 shrink-0" />
          <span className="min-w-0 shrink truncate">{pullRequest.targetBranch ?? "base"}</span>
        </div>
      ) : null}
    </div>
  );
}

function ProviderStatusStrip({
  metadata,
  totalChecks,
  loading,
}: {
  metadata: PreviewMetadata;
  totalChecks: number;
  loading: boolean;
}) {
  const approvalNeeded = Math.max(metadata.approvals.required - metadata.approvals.received, 0);
  const visibleReviewers = metadata.requestedReviewers.slice(0, 5);
  const hiddenReviewerCount = Math.max(metadata.requestedReviewers.length - visibleReviewers.length, 0);

  if (loading) {
    return (
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b bg-card px-6 py-3.5 text-sm">
        <span className="flex items-center gap-3">
          <span className="text-muted-foreground">Checks</span>
          <GhostLine className="h-5 w-28" />
        </span>
        <span className="flex items-center gap-3">
          <span className="text-muted-foreground">Reviews</span>
          <span className="flex items-center">
            {Array.from({ length: 5 }).map((_, index) => (
              <GhostCircle key={index} className={cn("size-7", index > 0 && "-ml-1.5")} />
            ))}
          </span>
          <GhostLine className="h-5 w-16" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-card px-6 py-3.5 text-sm">
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground">Checks</span>
        <span className="flex items-center gap-1">
          {Array.from({ length: metadata.checks.passing }).map((_, index) => (
            <CheckCircle2 key={`passing-${index}`} className="size-4 text-primary" />
          ))}
          {Array.from({ length: metadata.checks.pending }).map((_, index) => (
            <Circle key={`pending-${index}`} className="size-4 text-anvil-attention" />
          ))}
          {Array.from({ length: metadata.checks.failing }).map((_, index) => (
            <CircleAlert key={`failing-${index}`} className="size-4 text-destructive" />
          ))}
        </span>
        <span
          className={cn(
            "font-semibold",
            metadata.checks.failing > 0
              ? "text-destructive"
              : metadata.checks.pending > 0
                ? "text-anvil-attention"
                : "text-primary",
          )}
        >
          {metadata.checks.pending > 0 ? `${metadata.checks.pending} pending` : `${metadata.checks.passing}/${totalChecks}`}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">Reviews</span>
        <span className="flex min-w-0 items-center">
          {visibleReviewers.map((reviewer, index) => (
            <span
              key={`${reviewer}:${index}`}
              title={reviewer}
              className={cn(
                "grid size-7 place-items-center rounded-full border-2 border-card text-[10px] font-semibold",
                index > 0 && "-ml-1.5",
                index === 0 ? "bg-muted text-muted-foreground" : "bg-primary/12 text-primary",
              )}
            >
              {initialsFor(reviewer)}
            </span>
          ))}
          {hiddenReviewerCount > 0 ? (
            <span
              title={`${hiddenReviewerCount} more reviewer${hiddenReviewerCount === 1 ? "" : "s"}`}
              className="-ml-1.5 grid size-7 place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground"
            >
              +{hiddenReviewerCount}
            </span>
          ) : null}
        </span>
        <span className={cn("font-semibold", approvalNeeded > 0 ? "text-anvil-attention" : "text-primary")}>
          {metadata.approvals.received}
        </span>
        {approvalNeeded > 0 ? <span className="text-muted-foreground">({approvalNeeded} pending)</span> : null}
      </span>
    </div>
  );
}

function PreviewGhost({ activeTab }: { activeTab: "files" | "description" | "activity" }) {
  if (activeTab === "description") {
    return (
      <section className="grid max-w-3xl gap-3" aria-label="Loading description">
        <GhostLine className="h-3 w-24" />
        <div className="grid max-h-64 gap-3 overflow-hidden rounded-md border bg-background/60 px-3 py-3">
          <GhostLine className="h-4 w-5/6" />
          <GhostLine className="h-4 w-full" />
          <GhostLine className="h-4 w-3/4" />
          <GhostLine className="h-4 w-2/3" />
        </div>
      </section>
    );
  }

  if (activeTab === "activity") {
    return (
      <section className="grid gap-3" aria-label="Loading activity">
        <GhostLine className="h-3 w-28" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_4rem] gap-4 py-2.5">
            <GhostLine className="h-4 w-full" />
            <GhostLine className="h-4 w-12" />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="grid gap-4" aria-label="Loading changed files">
      <GhostLine className="h-3 w-24" />
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_8rem_4rem] items-center gap-4">
          <GhostLine className="h-4 w-full" />
          <GhostLine className="h-2 w-32" />
          <GhostLine className="h-4 w-10" />
        </div>
      ))}
    </section>
  );
}

function GhostLine({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded bg-muted", className)} />;
}

function GhostCircle({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded-full bg-muted", className)} />;
}

function ChangedFilesMap({ metadata }: { metadata: PreviewMetadata }) {
  if (metadata.changedFileGroups.length === 0) {
    return (
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changed files</h3>
        <p className="text-sm text-muted-foreground">No provider file list is cached for this pull request yet.</p>
      </section>
    );
  }

  const maxTotal = Math.max(
    1,
    ...metadata.changedFileGroups.flatMap((group) => group.files.map((file) => file.additions + file.deletions)),
  );

  return (
    <div className="grid gap-5">
      {metadata.changedFileGroups.map((group) => (
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

function ChangedFileRow({ file, maxTotal }: { file: PreviewFile; maxTotal: number }) {
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

function ActivityPreview({ metadata }: { metadata: PreviewMetadata }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h3>
      <div className="grid divide-y">
        {metadata.activity.map((event) => (
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

function DescriptionPreview({ metadata }: { metadata: PreviewMetadata }) {
  return (
    <div className="grid max-w-3xl gap-4">
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h3>
        <div className="max-h-64 overflow-y-auto rounded-md border bg-background/60 px-3 py-2 text-sm leading-6 text-muted-foreground">
          <MarkdownDescription markdown={metadata.description} />
        </div>
      </section>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labels</h3>
        <div className="flex flex-wrap gap-1.5">
          {metadata.labels.length > 0 ? metadata.labels.map((label) => (
            <span key={label} className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {label}
            </span>
          )) : <span className="text-sm text-muted-foreground">No labels cached.</span>}
        </div>
      </section>
    </div>
  );
}

function MarkdownDescription({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`heading-${index}`} className="mt-2 first:mt-0 font-semibold uppercase tracking-wide text-foreground/80">
          {renderInlineMarkdown(heading[2], `heading-${index}`)}
        </p>,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index]?.trim() ?? "")) {
        items.push((lines[index] ?? "").trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`${item}:${itemIndex}`} className="break-words">
              {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index]?.trimEnd() ?? "";
      if (!nextLine.trim() || /^(#{1,3})\s+/.test(nextLine) || /^[-*]\s+/.test(nextLine.trim())) break;
      paragraph.push(nextLine.trim());
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="my-2 first:mt-0 break-words [overflow-wrap:anywhere]">
        {renderInlineMarkdown(paragraph.join(" "), `paragraph-${index}`)}
      </p>,
    );
  }

  return <div>{blocks.length > 0 ? blocks : <p>No provider description is cached for this pull request yet.</p>}</div>;
}

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {renderInlineMarkdown(match[2], `${keyPrefix}-link-label-${match.index}`)}
        </a>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`} className="font-semibold text-foreground/85">
          {token.slice(2, -2)}
        </strong>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function sizeInitial(fileCount: number) {
  if (fileCount > 24) return "L";
  if (fileCount > 8) return "M";
  return "S";
}

function buildPreviewMetadata(pullRequest: QueuePullRequest): PreviewMetadata {
  const changedFileGroups = pullRequest.changedFileGroups ?? [];
  const fileCountFromGroups = changedFileGroups.reduce((sum, group) => sum + group.files.length, 0);
  const additionsCount =
    pullRequest.additionsCount ??
    changedFileGroups.flatMap((group) => group.files).reduce((sum, file) => sum + file.additions, 0);
  const deletionsCount =
    pullRequest.deletionsCount ??
    changedFileGroups.flatMap((group) => group.files).reduce((sum, file) => sum + file.deletions, 0);
  const changedFilesCount = pullRequest.changedFilesCount ?? fileCountFromGroups;

  return {
    changedFilesCount,
    commitsCount: pullRequest.commitsCount ?? 0,
    commentsCount: pullRequest.commentsCount ?? 0,
    tasksCount: pullRequest.tasksCount ?? 0,
    additionsCount,
    deletionsCount,
    checks: pullRequest.checks ?? { passing: 0, failing: 0, pending: 0 },
    approvals: pullRequest.approvals ?? { received: 0, required: 0 },
    requestedReviewers: pullRequest.requestedReviewers ?? [],
    description: pullRequest.description || "No provider description is cached for this pull request yet.",
    labels: pullRequest.labels ?? [],
    changedFileGroups,
    activity: pullRequest.activity?.length
      ? pullRequest.activity
      : [{ actor: pullRequest.author, detail: "opened or updated this pull request", age: pullRequest.age }],
  };
}
