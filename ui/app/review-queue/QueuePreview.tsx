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
  onPrepare: () => void;
  onOpenProvider: () => void;
};

export function QueuePreview({ pullRequest, onPrepare, onOpenProvider }: QueuePreviewProps) {
  const [activeTab, setActiveTab] = React.useState<"files" | "description" | "activity">("files");
  const ProviderIcon = providerIcon(pullRequest.provider);
  const metadata = React.useMemo(() => buildPreviewMetadata(pullRequest), [pullRequest]);
  const hasBranchRoute = Boolean(pullRequest.sourceBranch || pullRequest.targetBranch);
  const totalChecks = metadata.checks.passing + metadata.checks.failing + metadata.checks.pending;

  return (
    <aside className="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-5">
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
              <span className="text-muted-foreground/45">|</span>
              <span>{pullRequest.providerSource}</span>
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {pullRequest.providerSource} · opened {pullRequest.age}
            </div>
          </div>
          <PullRequestStats pullRequest={pullRequest} metadata={metadata} />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <ProviderStatusStrip metadata={metadata} totalChecks={totalChecks} />

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
              Files ({metadata.changedFilesCount})
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
          {activeTab === "files" ? (
            <ChangedFilesMap metadata={metadata} />
          ) : activeTab === "description" ? (
            <DescriptionPreview metadata={metadata} />
          ) : (
            <ActivityPreview metadata={metadata} />
          )}
          {hasBranchRoute ? (
            <div className="mt-5 max-w-4xl">
              <PreviewSection title="Branch route">
                <PreviewFact
                  label="Branches"
                  value={`${pullRequest.sourceBranch ?? "head"} -> ${pullRequest.targetBranch ?? "base"}`}
                />
              </PreviewSection>
            </div>
          ) : null}
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
}: {
  pullRequest: QueuePullRequest;
  metadata: PreviewMetadata;
}) {
  const hasBranchRoute = Boolean(pullRequest.sourceBranch || pullRequest.targetBranch);

  return (
    <div className="grid shrink-0 justify-items-end gap-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
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
        <div className="flex max-w-lg items-center gap-2 font-mono text-muted-foreground">
          <span className="truncate">{pullRequest.sourceBranch ?? "head"}</span>
          <ArrowRight className="size-3.5 shrink-0" />
          <span className="shrink-0">{pullRequest.targetBranch ?? "base"}</span>
        </div>
      ) : null}
    </div>
  );
}

function ProviderStatusStrip({
  metadata,
  totalChecks,
}: {
  metadata: PreviewMetadata;
  totalChecks: number;
}) {
  const approvalNeeded = Math.max(metadata.approvals.required - metadata.approvals.received, 0);

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
        {metadata.requestedReviewers.map((reviewer, index) => (
          <span
            key={`${reviewer}:${index}`}
            title={reviewer}
            className={cn(
              "grid size-6 place-items-center rounded-full text-[10px] font-semibold",
              index === 0 ? "bg-muted text-muted-foreground" : "bg-primary/12 text-primary",
            )}
          >
            {initialsFor(reviewer)}
          </span>
        ))}
        <span className={cn("font-semibold", approvalNeeded > 0 ? "text-anvil-attention" : "text-primary")}>
          {metadata.approvals.received}
        </span>
        {approvalNeeded > 0 ? <span className="text-muted-foreground">({approvalNeeded} pending)</span> : null}
      </span>
    </div>
  );
}

function ChangedFilesMap({ metadata }: { metadata: PreviewMetadata }) {
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
        <p className="text-sm leading-6 text-muted-foreground">{metadata.description}</p>
      </section>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labels</h3>
        <div className="flex flex-wrap gap-1.5">
          {metadata.labels.map((label) => (
            <span key={label} className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-card px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function sizeInitial(fileCount: number) {
  if (fileCount > 24) return "L";
  if (fileCount > 8) return "M";
  return "S";
}

function buildPreviewMetadata(pullRequest: QueuePullRequest): PreviewMetadata {
  const changedFilesCount = pullRequest.changedFilesCount ?? 6;
  const fakeFileGroups = buildFakeChangedFileGroups(pullRequest, changedFilesCount);
  const additionsCount = fakeFileGroups.flatMap((group) => group.files).reduce((sum, file) => sum + file.additions, 0);
  const deletionsCount = fakeFileGroups.flatMap((group) => group.files).reduce((sum, file) => sum + file.deletions, 0);

  return {
    changedFilesCount,
    // TODO(provider-metadata): replace these placeholders with provider commit, comment, check, approval, and activity fields.
    commitsCount: Math.max(1, Math.min(7, Math.ceil(changedFilesCount / 2))),
    commentsCount: changedFilesCount > 10 ? 5 : 2,
    additionsCount,
    deletionsCount,
    checks: {
      passing: pullRequest.status.toLowerCase().includes("fail") ? 2 : 4,
      failing: pullRequest.status.toLowerCase().includes("fail") ? 1 : 0,
      pending: pullRequest.status.toLowerCase().includes("pending") ? 1 : 0,
    },
    approvals: {
      received: pullRequest.isCreatedByMe ? 0 : 1,
      required: 2,
    },
    requestedReviewers: ["Lane Parton", pullRequest.author],
    description: `${pullRequest.title} is ready for review. Provider description text is placeholder data until the inbox loads PR details.`,
    labels: [pullRequest.provider, "review", pullRequest.needsReview ? "needs-review" : "open"],
    changedFileGroups: fakeFileGroups,
    activity: [
      { actor: pullRequest.author, detail: "opened this pull request", age: pullRequest.age },
      { actor: "Anvil", detail: "prepared a preview from inbox data", age: "now" },
    ],
  };
}

function buildFakeChangedFileGroups(pullRequest: QueuePullRequest, changedFilesCount: number): PreviewFileGroup[] {
  // TODO(provider-files): replace this synthetic file map with provider changed-file names, additions, and deletions.
  const repoSegment = pullRequest.repoName.split("/").pop() || "app";
  const files: PreviewFile[] = Array.from({ length: Math.max(1, Math.min(changedFilesCount, 8)) }, (_, index) => ({
    path:
      index === 0
        ? `ui/app/${repoSegment}/ReviewSurface.tsx`
        : index === 1
          ? `ui/lib/${repoSegment}-review.ts`
          : index === 2
            ? `desktop/src/runtime/${repoSegment}_review.rs`
            : `tests/review-${index + 1}.spec.ts`,
    additions: 12 + index * 7,
    deletions: index % 3 === 0 ? 4 + index : index % 2,
  }));

  return [
    {
      label: "Review surface",
      files: files.slice(0, Math.ceil(files.length / 2)),
    },
    {
      label: "Runtime and tests",
      files: files.slice(Math.ceil(files.length / 2)),
    },
  ].filter((group) => group.files.length > 0);
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 text-sm leading-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}
