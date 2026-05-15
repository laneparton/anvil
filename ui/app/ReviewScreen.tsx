import type { ReviewAgent, ReviewSessionEvent } from "@/lib/api";
import type { ProviderPullRequestLink } from "@/lib/provider-links";
import type {
  CommentDecision,
  ReviewProgressComment,
  ReviewProgressSlice,
  UseReviewProgressResult,
} from "@/lib/review-progress";
import type { AppSettings } from "@/lib/settings";

import { DecisionReviewScreen } from "./review-decision/DecisionReviewScreen";
import type { AgentLaunchState, SubmitState } from "./types";

export function ReviewScreen({
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
  handleCommentDecision: (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => void;
  handleOpenAgent: (agent: ReviewAgent) => void;
  highRiskPendingCount: number;
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
}) {
  return (
    <DecisionReviewScreen
      active={active}
      activeIndex={activeIndex}
      activePending={activePending}
      agentLaunchState={agentLaunchState}
      appSettings={appSettings}
      clearReview={clearReview}
      commentsByHunk={commentsByHunk}
      currentComment={currentComment}
      handleCommentDecision={handleCommentDecision}
      handleOpenAgent={handleOpenAgent}
      markActiveReviewed={markActiveReviewed}
      onExitReview={onExitReview}
      onOpenSettings={onOpenSettings}
      onOpenProvider={onOpenProvider}
      openComments={openComments}
      pendingSliceIds={pendingSliceIds}
      providerPullRequestLink={providerPullRequestLink}
      prepareEvent={prepareEvent}
      progress={progress}
      pullRequest={pullRequest}
      repo={repo}
      reviewComplete={reviewComplete}
      reviewTitle={reviewTitle}
      reviewWorktree={reviewWorktree}
      selectedCommentId={selectedCommentId}
      setActiveId={setActiveId}
      setSelectedCommentId={setSelectedCommentId}
      submitReview={submitReview}
      submitState={submitState}
    />
  );
}
