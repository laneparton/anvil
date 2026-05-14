import { ScrollArea } from "@/components/ui/scroll-area";
import { ReviewQueue } from "@/components/review/review-queue";
import { ReviewWorkspaceScreen } from "@/app/ReviewWorkspaceScreen";
import type { ReviewAgent, ReviewSessionEvent } from "@/lib/api";
import type {
  CommentDecision,
  ReviewProgressComment,
  ReviewProgressSlice,
  UseReviewProgressResult,
} from "@/lib/review-progress";
import type { AppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

import { DecisionRailPanel } from "./DecisionRailPanel";
import { ReviewCompleteState } from "./ReviewCompleteState";
import { SliceReviewPanel } from "./SliceReviewPanel";
import type { AgentLaunchState, SubmitState } from "./types";

export function ReviewScreen({
  acknowledgedDeferredCount,
  active,
  activeIndex,
  activePending,
  agentLaunchState,
  appSettings,
  clearReview,
  commentsByHunk,
  currentComment,
  deferredSlices,
  handleCommentDecision,
  handleOpenAgent,
  highRiskPendingCount,
  markActiveReviewed,
  onExitReview,
  onOpenSettings,
  openComments,
  pendingSliceIds,
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
}: {
  acknowledgedDeferredCount: number;
  active: ReviewProgressSlice;
  activeIndex: number;
  activePending: boolean;
  agentLaunchState: AgentLaunchState;
  appSettings: AppSettings;
  clearReview: () => void;
  commentsByHunk: Map<string, ReviewProgressComment[]>;
  currentComment: ReviewProgressComment | undefined;
  deferredSlices: ReviewProgressSlice[];
  handleCommentDecision: (
    comment: ReviewProgressComment,
    decision: Exclude<CommentDecision, "open">,
  ) => void;
  handleOpenAgent: (agent: ReviewAgent) => void;
  highRiskPendingCount: number;
  markActiveReviewed: () => void;
  onExitReview: () => void;
  onOpenSettings: () => void;
  openComments: ReviewProgressComment[];
  pendingSliceIds: Set<string>;
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
}) {
  return (
    <ReviewWorkspaceScreen
      repo={repo}
      pullRequest={pullRequest}
      title={reviewTitle}
      onExitReview={onExitReview}
      onOpenSettings={onOpenSettings}
      queue={
        <ScrollArea className="border-r">
          <ReviewQueue
            slices={progress.slices}
            activeId={active.id}
            pendingSliceIds={pendingSliceIds}
            onSelect={setActiveId}
          />
        </ScrollArea>
      }
      content={
        <ScrollArea>
          <section className={cn("p-5", reviewComplete && "grid min-h-full place-items-center")}>
            {reviewComplete ? (
              <ReviewCompleteState
                queuedComments={progress.queuedComments}
                dismissedCount={progress.counts.dismissedComments}
                fixedCount={progress.counts.resolvedComments}
                deferredSlices={deferredSlices}
                acknowledgedDeferredCount={acknowledgedDeferredCount}
                highRiskPendingCount={highRiskPendingCount}
                slices={progress.slices}
                submitState={submitState}
                submitReview={submitReview}
                clearReview={clearReview}
              />
            ) : (
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
            )}
          </section>
        </ScrollArea>
      }
      rail={
        <ScrollArea className="border-l bg-background">
          <DecisionRailPanel
            active={active}
            activePending={activePending}
            agentLaunchState={agentLaunchState}
            appSettings={appSettings}
            currentComment={currentComment}
            handleCommentDecision={handleCommentDecision}
            handleOpenAgent={handleOpenAgent}
            markActiveReviewed={markActiveReviewed}
            openComments={openComments}
            prepareEvent={prepareEvent}
            queuedComments={progress.queuedComments}
            reviewComplete={reviewComplete}
            reviewWorktree={reviewWorktree}
            selectedCommentId={selectedCommentId}
            setActiveId={setActiveId}
            setSelectedCommentId={setSelectedCommentId}
            setCommentDraft={progress.setCommentDraft}
            setCommentDecision={progress.setCommentDecision}
            resetCommentDecision={progress.resetCommentDecision}
            setSliceReviewed={progress.setSliceReviewed}
          />
        </ScrollArea>
      }
    />
  );
}
