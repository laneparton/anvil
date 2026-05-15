import * as React from "react";
import { ArrowRight, ExternalLink, FileCode2, GitPullRequest } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { initialsFor, providerIcon, providerIconTone } from "./format";
import { QueueStatusPill } from "./StatusPill";
import type { QueuePullRequest } from "./types";

type QueuePreviewProps = {
  pullRequest: QueuePullRequest;
  onPrepare: () => void;
  onOpenProvider: () => void;
};

export function QueuePreview({ pullRequest, onPrepare, onOpenProvider }: QueuePreviewProps) {
  const ProviderIcon = providerIcon(pullRequest.provider);
  const hasBranchRoute = Boolean(pullRequest.sourceBranch || pullRequest.targetBranch);

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
              opened {pullRequest.age}
            </div>
          </div>
          <PullRequestStats pullRequest={pullRequest} />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <div className="border-b bg-card px-6 py-2">
          <div className="flex items-center gap-2">
            <button type="button" className="h-8 rounded-md bg-accent px-3 text-sm font-semibold text-foreground">
              Overview
            </button>
          </div>
        </div>

        <div className="grid max-w-4xl gap-5 px-6 py-5">
          <PreviewSection title="Runtime metadata">
            <dl className="grid gap-2 sm:grid-cols-2">
              <PreviewFact label="Provider" value={pullRequest.providerSource} />
              <PreviewFact label="Repository" value={pullRequest.repoName} />
              <PreviewFact label="Author" value={pullRequest.author} />
              <PreviewFact label="Status" value={pullRequest.status || "open"} />
              {pullRequest.changedFilesCount !== undefined ? (
                <PreviewFact label="Changed files" value={`${pullRequest.changedFilesCount}`} />
              ) : null}
              {hasBranchRoute ? (
                <PreviewFact
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

function PullRequestStats({ pullRequest }: { pullRequest: QueuePullRequest }) {
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

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-card px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 text-sm leading-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}
