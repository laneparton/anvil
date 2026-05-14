import * as React from "react";

import { submitReviewSession } from "@/lib/api";
import { formatUnknownError } from "@/lib/errors";
import type { ReviewProgressComment } from "@/lib/review-progress";
import type { ReviewPlan } from "@/lib/review-types";

import type { AppStage, SubmitState } from "./types";

export function useReviewSubmit({
  activeSessionId,
  effectiveSelectedSource,
  progressQueuedComments,
  reviewPlan,
  clearProgress,
  resetPreparation,
  setActiveId,
  setSelectedCommentId,
  setStage,
  refreshInbox,
}: {
  activeSessionId?: string;
  effectiveSelectedSource: string;
  progressQueuedComments: ReviewProgressComment[];
  reviewPlan: ReviewPlan;
  clearProgress: () => void;
  resetPreparation: () => void;
  setActiveId: (activeId: string | undefined) => void;
  setSelectedCommentId: (commentId: string | undefined) => void;
  setStage: React.Dispatch<React.SetStateAction<AppStage>>;
  refreshInbox: () => void;
}) {
  const [submitState, setSubmitState] = React.useState<SubmitState>({ status: "idle" });
  const returnToLauncherTimer = React.useRef<number | undefined>(undefined);

  const returnToLauncherAfterSubmit = React.useCallback(() => {
    if (returnToLauncherTimer.current) {
      window.clearTimeout(returnToLauncherTimer.current);
    }

    returnToLauncherTimer.current = window.setTimeout(() => {
      clearProgress();
      resetPreparation();
      setSelectedCommentId(undefined);
      setSubmitState({ status: "idle" });
      setStage("launcher");
      refreshInbox();
      returnToLauncherTimer.current = undefined;
    }, 1200);
  }, [clearProgress, refreshInbox, resetPreparation, setSelectedCommentId, setStage]);

  const submitReview = React.useCallback(() => {
    if (!activeSessionId) {
      setSubmitState({ status: "error", error: "No active review session is available to submit." });
      return;
    }

    setSubmitState({ status: "submitting" });
    submitReviewSession({
      sessionId: activeSessionId,
      source: effectiveSelectedSource,
      repo: reviewPlan.pr.repo,
      pullRequest: String(reviewPlan.pr.number),
      action: progressQueuedComments.length > 0 ? "comment" : "approve",
      comments: progressQueuedComments,
    })
      .then((receipt) => {
        setSubmitState({
          status: "submitted",
          receiptId:
            typeof receipt.receiptId === "string"
              ? receipt.receiptId
              : typeof receipt.id === "string"
                ? receipt.id
                : undefined,
        });
        returnToLauncherAfterSubmit();
      })
      .catch((error: unknown) => {
        setSubmitState({ status: "error", error: formatUnknownError(error) });
      });
  }, [
    activeSessionId,
    effectiveSelectedSource,
    progressQueuedComments,
    returnToLauncherAfterSubmit,
    reviewPlan.pr.number,
    reviewPlan.pr.repo,
  ]);

  const clearReview = React.useCallback(() => {
    clearProgress();
    setSubmitState({ status: "idle" });
    setSelectedCommentId(undefined);
    setActiveId(reviewPlan.slices[0]?.id);
  }, [clearProgress, reviewPlan.slices, setActiveId, setSelectedCommentId]);

  React.useEffect(() => {
    return () => {
      if (returnToLauncherTimer.current) {
        window.clearTimeout(returnToLauncherTimer.current);
      }
    };
  }, []);

  return {
    clearReview,
    setSubmitState,
    submitReview,
    submitState,
  };
}
