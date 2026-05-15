import { Cloud, GitPullRequest, Settings, XCircle } from "lucide-react";

import { AppShell } from "@/app/AppShell";
import { SliceReviewPanel } from "@/app/SliceReviewPanel";
import { Button } from "@/components/ui/button";
import type { ReviewAgent, ReviewSessionEvent } from "@/lib/api";
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
  commentsByHunk: Map<string, ReviewProgressComment[]>;
  currentComment: ReviewProgressComment | undefined;
  handleCommentDecision: (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => void;
  handleOpenAgent: (agent: ReviewAgent) => void;
  markActiveReviewed: () => void;
  onExitReview: () => void;
  onOpenSettings: () => void;
  onOpenProvider?: () => void;
  openComments: ReviewProgressComment[];
  pendingSliceIds: Set<string>;
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
  submitReview: () => void;
  submitState: SubmitState;
};

export function DecisionReviewScreen({
  active,
  activeIndex,
  activePending,
  agentLaunchState,
  appSettings,
  clearReview,
  commentsByHunk,
  currentComment,
  handleCommentDecision,
  handleOpenAgent,
  markActiveReviewed,
  onExitReview,
  onOpenSettings,
  onOpenProvider,
  openComments,
  pendingSliceIds,
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
  const ProviderIcon = providerPullRequestLink?.provider === "bitbucket" ? Cloud : GitPullRequest;
  const providerTone =
    providerPullRequestLink?.provider === "bitbucket"
      ? "border-[#0052cc]/25 bg-[#0052cc]/5 text-[#253858] hover:bg-[#0052cc]/10"
      : "border-[#24292f]/20 bg-[#24292f]/5 text-[#24292f] hover:bg-[#24292f]/10";
  const providerIconTone = providerPullRequestLink?.provider === "bitbucket" ? "text-[#0052cc]" : "text-[#24292f]";
  const submitLabel =
    submitState.status === "submitting"
      ? "Submitting..."
      : submitState.status === "submitted"
        ? "Review submitted"
        : progress.queuedComments.length > 0
          ? `Submit ${progress.queuedComments.length} ${progress.queuedComments.length === 1 ? "comment" : "comments"}`
          : "Approve PR";
  const submitDisabled = submitState.status === "submitted" || submitState.status === "submitting";

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
      <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
        <main className={cn("min-h-0 overflow-y-auto p-5", reviewComplete && "grid place-items-center")}>
          {reviewComplete ? (
            <ReviewPacketSummary
              clearReview={clearReview}
              error={submitState.status === "error" ? submitState.error : undefined}
              receiptId={submitState.receiptId}
            />
          ) : (
            <div className="grid gap-4">
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
              <SliceReviewPanel
                active={active}
                activeIndex={activeIndex}
                activePending={activePending}
                commentsByHunk={commentsByHunk}
                currentComment={currentComment}
                openComments={openComments}
                prepareEvent={prepareEvent}
                selectedCommentId={selectedCommentId}
                setSelectedCommentId={setSelectedCommentId}
                totalSlices={progress.slices.length}
              />
            </div>
          )}
        </main>

        <DecisionLedgerPanel
          activeId={active.id}
          reviewComplete={reviewComplete}
          slices={progress.slices}
          queuedComments={progress.queuedComments}
          onSelect={setActiveId}
          onSubmitReview={submitReview}
          submitDisabled={submitDisabled}
          submitLabel={submitLabel}
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

function ReviewPacketSummary({
  clearReview,
  error,
  receiptId,
}: {
  clearReview: () => void;
  error?: string;
  receiptId?: string;
}) {
  return (
    <div className="grid w-full max-w-3xl gap-3 rounded-lg border bg-card p-5 text-center shadow-sm">
      <h2 className="text-2xl font-semibold">Review packet ready</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Final review decisions are staged in the ledger. Submit from the review packet panel.
      </p>
      {error ? (
        <div className="whitespace-pre-wrap rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive">
          {error}
        </div>
      ) : null}
      {receiptId ? (
        <div className="justify-self-center rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
          Receipt: {receiptId}
        </div>
      ) : null}
      <Button
        type="button"
        className="h-8 w-fit justify-self-center border-border bg-background px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={clearReview}
      >
        Clear review
      </Button>
    </div>
  );
}
