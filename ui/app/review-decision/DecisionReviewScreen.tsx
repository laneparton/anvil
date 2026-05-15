import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  GitPullRequest,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReviewAgent, ReviewSessionEvent, SubmitReviewAction } from "@/lib/api";
import type { ProviderPullRequestLink } from "@/lib/provider-links";
import type {
  CommentDecision,
  ReviewProgressComment,
  ReviewProgressSlice,
  UseReviewProgressResult,
} from "@/lib/review-progress";
import type { AppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

import { DecisionLedgerPanel } from "./DecisionLedgerPanel";
import { DecisionStage } from "./DecisionStage";
import type { AgentLaunchState, SubmitState } from "../types";

type DecisionReviewScreenProps = {
  active: ReviewProgressSlice;
  activeIndex: number;
  activePending: boolean;
  agentLaunchState: AgentLaunchState;
  appSettings: AppSettings;
  clearReview: () => void;
  currentComment: ReviewProgressComment | undefined;
  handleCommentDecision: (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => void;
  handleOpenAgent: (agent: ReviewAgent) => void;
  markActiveReviewed: () => void;
  onExitReview: () => void;
  onOpenSettings: () => void;
  onOpenProvider?: () => void;
  openComments: ReviewProgressComment[];
  pendingSliceCount: number;
  providerPullRequestLink?: ProviderPullRequestLink;
  prepareEvent?: ReviewSessionEvent;
  progress: UseReviewProgressResult;
  pullRequest: string | number;
  repo: string;
  reviewComplete: boolean;
  reviewTitle: string;
  reviewWorktree?: string;
  selectedCommentId: string | undefined;
  setActiveId: (activeId: string) => void;
  setSelectedCommentId: (commentId: string) => void;
  submitReview: (actionOverride?: SubmitReviewAction) => void;
  submitState: SubmitState;
};

export function DecisionReviewScreen({
  active,
  activeIndex,
  activePending,
  agentLaunchState,
  appSettings,
  clearReview,
  currentComment,
  handleCommentDecision,
  handleOpenAgent,
  markActiveReviewed,
  onExitReview,
  onOpenSettings,
  onOpenProvider,
  openComments,
  pendingSliceCount,
  providerPullRequestLink,
  prepareEvent,
  progress,
  pullRequest,
  repo,
  reviewComplete,
  reviewTitle,
  reviewWorktree,
  selectedCommentId,
  setActiveId,
  setSelectedCommentId,
  submitReview,
  submitState,
}: DecisionReviewScreenProps) {
  const [viewMode, setViewMode] = React.useState<"decision" | "summary">("decision");
  const [reviewAction, setReviewAction] = React.useState<"comment" | "approve">("comment");
  const ProviderIcon = providerPullRequestLink?.provider === "bitbucket" ? Cloud : GitPullRequest;
  const providerTone =
    providerPullRequestLink?.provider === "bitbucket"
      ? "border-[#0052cc]/25 bg-[#0052cc]/5 text-[#253858] hover:bg-[#0052cc]/10"
      : "border-[#24292f]/20 bg-[#24292f]/5 text-[#24292f] hover:bg-[#24292f]/10";
  const providerIconTone = providerPullRequestLink?.provider === "bitbucket" ? "text-[#0052cc]" : "text-[#24292f]";
  const effectiveReviewAction = progress.queuedComments.length > 0 ? reviewAction : "approve";
  const submitLabel =
    submitState.status === "submitting"
      ? "Submitting..."
      : submitState.status === "submitted"
        ? "Review submitted"
        : effectiveReviewAction === "comment"
          ? `Submit ${progress.queuedComments.length} ${progress.queuedComments.length === 1 ? "comment" : "comments"}`
          : "Approve PR";
  const submitDisabled = submitState.status === "submitted" || submitState.status === "submitting";
  const handledComments = progress.comments.filter(
    (comment) => comment.decision === "dismissed" || comment.decision === "resolved",
  );
  const deferredSlices = progress.slices.filter((slice) => slice.deferred || slice.comments.some((comment) => comment.decision === "resolved"));
  const showingSummary = reviewComplete && viewMode === "summary";

  React.useEffect(() => {
    if (reviewComplete) {
      setViewMode("summary");
    }
  }, [reviewComplete]);

  const selectDecision = React.useCallback(
    (sliceId: string) => {
      setActiveId(sliceId);
      setViewMode("decision");
    },
    [setActiveId],
  );

  return (
    <AppShell
      eyebrow={`${repo} #${pullRequest}`}
      title={reviewTitle}
      actions={
        <>
          {providerPullRequestLink ? (
            <Button type="button" className={cn("h-8 px-2 text-xs", providerTone)} onClick={onOpenProvider}>
              <ProviderIcon className={cn("size-3.5", providerIconTone)} />
              {providerPullRequestLink.label}
            </Button>
          ) : null}
          <Button
            type="button"
            className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onOpenSettings}
          >
            <Settings className="size-3.5" />
            Settings
          </Button>
          <Button
            type="button"
            className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onExitReview}
          >
            <XCircle className="size-3.5" />
            Exit review
          </Button>
        </>
      }
    >
      <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
        <main className="relative min-h-0 overflow-y-auto p-5">
          {pendingSliceCount > 0 ? <StreamingProgressStrip /> : null}
          {showingSummary ? (
            <SubmissionPreviewMain
              clearReview={clearReview}
              comments={progress.queuedComments}
              disposition={effectiveReviewAction}
              error={submitState.status === "error" ? submitState.error : undefined}
              handledComments={handledComments}
              onDispositionChange={setReviewAction}
              onOpenSlice={selectDecision}
              onSubmitReview={() => submitReview(effectiveReviewAction)}
              receiptId={submitState.receiptId}
              submitDisabled={submitDisabled}
              submitLabel={submitLabel}
            />
          ) : (
            <div className="grid gap-5">
              <DecisionStage
                active={active}
                activeIndex={activeIndex}
                activePending={activePending}
                agentLaunchState={agentLaunchState}
                appSettings={appSettings}
                currentComment={currentComment}
                handleCommentDecision={handleCommentDecision}
                handleOpenAgent={handleOpenAgent}
                markActiveReviewed={markActiveReviewed}
                openComments={openComments}
                prepareEvent={prepareEvent}
                reviewWorktree={reviewWorktree}
                selectedCommentId={selectedCommentId}
                setSelectedCommentId={setSelectedCommentId}
                setCommentDraft={progress.setCommentDraft}
                totalSlices={progress.slices.length}
              />
              <SliceNavigationFooter
                activeIndex={activeIndex}
                slices={progress.slices}
                onSelect={setActiveId}
              />
            </div>
          )}
        </main>

        <DecisionLedgerPanel
          activeId={active.id}
          deferredSlices={deferredSlices}
          reviewComplete={reviewComplete}
          pendingSliceCount={pendingSliceCount}
          slices={progress.slices}
          queuedComments={progress.queuedComments}
          summaryActive={showingSummary}
          onSelect={selectDecision}
          onSelectSummary={() => setViewMode("summary")}
        />
      </section>
      {submitState.status === "error" && !reviewComplete ? (
        <div className="fixed bottom-4 left-1/2 z-20 max-w-xl -translate-x-1/2 whitespace-pre-wrap rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive shadow-lg">
          {submitState.error || "Review submission failed, but the provider did not return an error message."}
        </div>
      ) : null}
    </AppShell>
  );
}

function StreamingProgressStrip() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-1 overflow-hidden bg-primary/10">
      <div className="anvil-progress-strip h-full w-1/3 rounded-r-full bg-primary/60" />
    </div>
  );
}

function SliceNavigationFooter({
  activeIndex,
  slices,
  onSelect,
}: {
  activeIndex: number;
  slices: ReviewProgressSlice[];
  onSelect: (sliceId: string) => void;
}) {
  const previous = activeIndex > 0 ? slices[activeIndex - 1] : undefined;
  const next = activeIndex < slices.length - 1 ? slices[activeIndex + 1] : undefined;

  return (
    <nav className="grid grid-cols-[1fr_auto_1fr] items-center border-t px-2 py-5" aria-label="Slice navigation">
      <button
        type="button"
        disabled={!previous}
        onClick={() => previous && onSelect(previous.id)}
        className="inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
      >
        <ChevronLeft className="size-4" />
        Previous slice
      </button>

      <div className="flex items-center justify-center gap-2">
        {slices.map((slice, index) => (
          <button
            key={slice.id}
            type="button"
            onClick={() => onSelect(slice.id)}
            aria-label={`Open slice ${index + 1}`}
            className={cn(
              "size-2 rounded-full transition-colors",
              index === activeIndex ? "bg-primary" : "bg-muted hover:bg-muted-foreground/35",
            )}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={!next}
        onClick={() => next && onSelect(next.id)}
        className="ml-auto inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
      >
        Next slice
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}

function SubmissionPreviewMain({
  clearReview,
  comments,
  disposition,
  error,
  handledComments,
  onDispositionChange,
  onOpenSlice,
  onSubmitReview,
  receiptId,
  submitDisabled,
  submitLabel,
}: {
  clearReview: () => void;
  comments: ReviewProgressComment[];
  disposition: "comment" | "approve";
  error?: string;
  handledComments: ReviewProgressComment[];
  onDispositionChange: (disposition: "comment" | "approve") => void;
  onOpenSlice: (sliceId: string) => void;
  onSubmitReview: () => void;
  receiptId?: string;
  submitDisabled: boolean;
  submitLabel: string;
}) {
  const providerAction =
    comments.length > 0
      ? `${comments.length} comment${comments.length === 1 ? "" : "s"} to provider`
      : "Approve without comments";

  return (
    <section className="mx-auto max-w-5xl">
      <div className="overflow-hidden rounded-lg border border-t-primary bg-card shadow-sm">
        <div className="p-4">
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
              <Button type="button" className="border-border bg-background" onClick={clearReview}>
                <ShieldCheck className="size-4" />
                Clear packet
              </Button>
              <ReviewDispositionButton disposition={disposition} onDispositionChange={onDispositionChange} />
              <Button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={submitDisabled}
                onClick={onSubmitReview}
              >
                <MessageSquarePlus className="size-4" />
                {submitLabel}
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t bg-anvil-info/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground">
            <span>{comments.length} comment{comments.length === 1 ? "" : "s"} ready for provider submit</span>
            <span>{handledComments.length} kept local</span>
          </div>
        </div>

        {error ? (
          <div className="mx-4 mt-4 whitespace-pre-wrap rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive">
            {error}
          </div>
        ) : null}
        {receiptId ? (
          <div className="mx-4 mt-4 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
            Receipt: {receiptId}
          </div>
        ) : null}

        <div className="grid gap-4 p-4">
          <SectionHeader title="Comments to post" count={comments.length} />
          {comments.length > 0 ? (
            <div className="grid gap-3">
              {comments.map((comment) => (
                <PreviewComment key={comment.id} comment={comment} onOpen={() => onOpenSlice(comment.sliceId)} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No comments will be posted.</p>
          )}
        </div>

        <div className="border-t bg-background/50 px-4 py-3">
          <SectionHeader title="Kept local" count={handledComments.length} />
          {handledComments.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {handledComments.map((comment) => (
                <li key={comment.id} className="flex items-center justify-between gap-3 text-sm leading-5 text-muted-foreground">
                  <span>{comment.body}</span>
                  <span className="shrink-0 text-xs">{comment.decision === "resolved" ? "Deferred" : "Looks safe"}</span>
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
  disposition: "comment" | "approve";
  onDispositionChange: (disposition: "comment" | "approve") => void;
}) {
  const [open, setOpen] = React.useState(false);
  const label = disposition === "comment" ? "Submit comments" : "Approve PR";
  const selectDisposition = (nextDisposition: "comment" | "approve") => {
    onDispositionChange(nextDisposition);
    setOpen(false);
  };

  return (
    <div className="relative inline-flex">
      <div className="inline-flex h-9 overflow-hidden rounded-md shadow-sm">
        <button type="button" className="bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
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
            disposition="comment"
            label="Submit comments"
            selected={disposition === "comment"}
            onSelect={selectDisposition}
          />
          <ReviewDispositionOption
            disposition="approve"
            label="Approve PR"
            selected={disposition === "approve"}
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
  disposition: "comment" | "approve";
  label: string;
  selected: boolean;
  onSelect: (disposition: "comment" | "approve") => void;
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

function PreviewComment({ comment, onOpen }: { comment: ReviewProgressComment; onOpen: () => void }) {
  return (
    <button type="button" className="rounded-md border bg-card text-left transition-colors hover:bg-accent/40" onClick={onOpen}>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 p-3">
        <span className="grid size-7 place-items-center rounded-full bg-anvil-info/10 text-[11px] font-semibold text-anvil-info">
          A
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-foreground">Anvil</span>
            <span className="text-xs text-muted-foreground">will comment</span>
            <span className="font-mono text-xs text-muted-foreground">
              {comment.file}:{comment.line}
            </span>
          </div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">{comment.severity}</div>
          <p className="mt-2 text-sm leading-6 text-foreground">{comment.draft || comment.body}</p>
        </div>
      </div>
    </button>
  );
}
