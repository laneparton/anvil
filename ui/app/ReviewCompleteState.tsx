import { Button } from "@/components/ui/button";
import { ReviewCompletePanel } from "@/components/review/review-complete-panel";
import type { ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
import { countOpenQuestions } from "@/lib/review-workflow";

import type { SubmitState } from "./types";

export function ReviewCompleteState({
  acknowledgedDeferredCount,
  clearReview,
  deferredSlices,
  dismissedCount,
  fixedCount,
  highRiskPendingCount,
  queuedComments,
  submitReview,
  submitState,
  slices,
}: {
  acknowledgedDeferredCount: number;
  clearReview: () => void;
  deferredSlices: ReviewProgressSlice[];
  dismissedCount: number;
  fixedCount: number;
  highRiskPendingCount: number;
  queuedComments: ReviewProgressComment[];
  submitReview: () => void;
  submitState: SubmitState;
  slices: ReviewProgressSlice[];
}) {
  const handledLocalItems = slices.flatMap((slice) =>
    slice.comments.flatMap((comment) =>
      comment.decision === "dismissed" || comment.decision === "resolved"
        ? [`${comment.decision}: ${comment.file}:${comment.line}`]
        : [],
    ),
  );
  const acknowledgedDeferredItems = deferredSlices.flatMap((slice) =>
    slice.reviewed ? [`${slice.title}: ${slice.deferReason || "Needs later review."}`] : [],
  );

  return (
    <div className="grid w-full max-w-3xl gap-3">
      <ReviewCompletePanel
        queuedCount={queuedComments.length}
        dismissedCount={dismissedCount}
        fixedCount={fixedCount}
        unresolvedQuestionCount={countOpenQuestions(slices)}
        deferredCount={deferredSlices.length}
        acknowledgedDeferredCount={acknowledgedDeferredCount}
        highRiskPendingCount={highRiskPendingCount}
        submitLabel={
          submitState.status === "submitting"
            ? "Submitting..."
            : submitState.status === "submitted"
              ? "Review submitted"
              : queuedComments.length > 0
                ? `Submit ${queuedComments.length} ${queuedComments.length === 1 ? "comment" : "comments"}`
                : "Approve PR"
        }
        submitDisabled={
          submitState.status === "submitted" ||
          submitState.status === "submitting" ||
          highRiskPendingCount > 0
        }
        sections={[
          {
            title: "Ready to post",
            items: queuedComments.map((comment) => `${comment.file}:${comment.line}`),
            emptyMessage: "No PR comments queued.",
          },
          {
            title: "Handled locally",
            items: handledLocalItems,
            emptyMessage: "No dismissed or fixed findings.",
          },
          {
            title: "Deferred acknowledged",
            items: acknowledgedDeferredItems,
            emptyMessage: "No deferred slices.",
          },
        ]}
        onSubmitReview={submitReview}
      />
      {submitState.status === "error" ? (
        <div className="whitespace-pre-wrap rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive">
          {submitState.error || "Review submission failed, but the provider did not return an error message."}
        </div>
      ) : null}
      {submitState.receiptId ? (
        <div className="justify-self-center rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
          Receipt: {submitState.receiptId}
        </div>
      ) : null}
      <Button
        type="button"
        className="h-7 w-fit justify-self-center border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={clearReview}
      >
        Clear review
      </Button>
    </div>
  );
}
