import * as React from "react";
import {
  cancelReviewSession,
  startReviewSession,
  subscribeReviewSession,
  type ReviewSessionEvent,
  type ReviewSessionReadyData,
  type StartReviewSessionRequest,
} from "@/lib/api";
import { formatUnknownError } from "@/lib/errors";
import type { ReviewPlan } from "@/lib/review-types";
import {
  createPlannedReviewPlan,
  createPrepareState,
  createReviewSessionEvent,
  createReviewSessionId,
  findLatestReviewWorktree,
  findInitialReviewSliceId,
  getPlannedSlices,
  getReadySlice,
  hasOpenReviewWork,
  isReviewSessionReadyData,
  mergeStreamingSlice,
  normalizeReviewPlan,
  normalizeSlice,
  orderPlannedSlices,
  type PendingPrepareRequest,
} from "./review-preparation";

export type ReviewPreparationOpenedEvent = {
  activeSliceId?: string;
};

export type UseReviewPreparationOptions = {
  initialReviewPlan: ReviewPlan;
  clearProgress: () => void;
  onReviewOpened: (event: ReviewPreparationOpenedEvent) => void;
  onPreparationCanceled: () => void;
};

export function useReviewPreparation({
  initialReviewPlan,
  clearProgress,
  onReviewOpened,
  onPreparationCanceled,
}: UseReviewPreparationOptions) {
  const [reviewPlan, setReviewPlan] = React.useState<ReviewPlan>(initialReviewPlan);
  const [prepareState, setPrepareState] = React.useState(() => createPrepareState("idle"));
  const [prepareRunId, setPrepareRunId] = React.useState(0);
  const [prepareRequest, setPrepareRequest] = React.useState<PendingPrepareRequest | undefined>();
  const [pendingSliceIds, setPendingSliceIds] = React.useState<Set<string>>(() => new Set());
  const [activeSessionId, setActiveSessionId] = React.useState<string | undefined>();

  const reviewWorktree = React.useMemo(
    () => prepareState.artifacts?.worktree ?? findLatestReviewWorktree(prepareState.events),
    [prepareState.artifacts?.worktree, prepareState.events],
  );

  const openReview = React.useCallback(
    (activeSliceId: string | undefined, shouldClearProgress: boolean) => {
      if (shouldClearProgress) {
        clearProgress();
      }
      onReviewOpened({ activeSliceId });
    },
    [clearProgress, onReviewOpened],
  );

  const startPreparation = React.useCallback((request: PendingPrepareRequest) => {
    setPrepareRequest(request);
    setActiveSessionId(undefined);
    setPendingSliceIds(new Set());
    setPrepareState(createPrepareState("idle"));
    setPrepareRunId((id) => id + 1);
  }, []);

  const resetPreparation = React.useCallback(() => {
    setActiveSessionId(undefined);
    setPrepareRequest(undefined);
  }, []);

  const cancelPreparation = React.useCallback(() => {
    const sessionId = prepareState.sessionId;
    setPrepareState((current) => ({ ...current, canceling: Boolean(sessionId) }));

    if (!sessionId) {
      resetPreparation();
      onPreparationCanceled();
      return;
    }

    cancelReviewSession(sessionId)
      .catch((error: Error) => {
        setPrepareState((current) => ({
          ...current,
          events: [...current.events, createReviewSessionEvent("session.cancel_failed", error.message)],
        }));
      })
      .finally(() => {
        resetPreparation();
        onPreparationCanceled();
      });
  }, [onPreparationCanceled, prepareState.sessionId, resetPreparation]);

  React.useEffect(() => {
    if (prepareRunId === 0) {
      return;
    }

    let cancelled = false;
    let completed = false;
    let openedReview = false;
    let hasStreamingPlan = false;
    const streamedSliceIds = new Set<string>();
    let subscription: { unsubscribe: () => void } | undefined;
    const sessionId = createReviewSessionId();
    if (!prepareRequest) {
      return;
    }

    const request: StartReviewSessionRequest = {
      sessionId,
      source: prepareRequest.source,
      repo: prepareRequest.repo,
      pullRequest: prepareRequest.pullRequest,
    };

    const appendEvent = (event: ReviewSessionEvent) => {
      setPrepareState((current) => ({
        ...current,
        events: [...current.events, event],
      }));
    };
    const enterReview = (data: ReviewSessionReadyData, sessionId?: string) => {
      if (cancelled) return;
      completed = true;
      setPendingSliceIds(new Set());
      const normalizedPlan = normalizeReviewPlan(data.plan);
      setReviewPlan(normalizedPlan);
      if (!openedReview) {
        openedReview = true;
        openReview(findInitialReviewSliceId(normalizedPlan), true);
      }
      setActiveSessionId(sessionId);
      setPrepareState((current) => ({
        ...current,
        status: "ready",
        artifacts: data.artifacts,
      }));
    };

    setPrepareState({
      ...createPrepareState("loading"),
      sessionId,
      events: [
        createReviewSessionEvent("session.created", `Created review session ${sessionId}.`),
        createReviewSessionEvent("session.subscribing", "Subscribing to Tauri review events."),
      ],
    });
    setActiveSessionId(sessionId);

    subscribeReviewSession(sessionId, {
      onEvent: (event) => {
        if (cancelled) return;
        appendEvent(event);

        const readySlice = getReadySlice(event.data);
        if (event.type === "slice.ready" && readySlice) {
          const normalizedReadySlice = normalizeSlice(readySlice);
          streamedSliceIds.add(normalizedReadySlice.id);
          setPendingSliceIds((current) => {
            const next = new Set(current);
            next.delete(normalizedReadySlice.id);
            return next;
          });
          setReviewPlan((current) =>
            mergeStreamingSlice(
              current,
              normalizedReadySlice,
              prepareRequest,
              !hasStreamingPlan,
            ),
          );
          hasStreamingPlan = true;

          if (!openedReview && hasOpenReviewWork(normalizedReadySlice)) {
            openedReview = true;
            openReview(normalizedReadySlice.id, true);
          }
        }

        const plannedSlices = getPlannedSlices(event.data);
        if (event.type === "planner.ready" && plannedSlices.length > 0) {
          const orderedPlannedSlices = orderPlannedSlices(plannedSlices);
          setReviewPlan((current) => createPlannedReviewPlan(current, orderedPlannedSlices, prepareRequest));
          setPendingSliceIds(new Set(orderedPlannedSlices.map((slice) => slice.id).filter((id) => !streamedSliceIds.has(id))));
          hasStreamingPlan = true;
        }

        const readyData =
          isReviewSessionReadyData(event.data) ? event.data :
          isReviewSessionReadyData(event) ? event :
          undefined;

        if ((event.type === "review.ready" || event.type === "session.completed") && readyData) {
          enterReview(readyData, sessionId);
        }

        if (event.type === "review.failed" || event.type === "session.failed") {
          completed = true;
          setPrepareState((current) => ({
            ...current,
            status: "error",
            error: event.message || "Review session failed.",
          }));
        }
      },
      onError: (error) => {
        if (cancelled || completed) return;
        completed = true;
        appendEvent(createReviewSessionEvent("session.listen_failed", error.message));
        setPrepareState((current) => ({ ...current, status: "error", error: error.message }));
      },
    })
      .then((nextSubscription) => {
        if (cancelled) {
          nextSubscription.unsubscribe();
          return;
        }
        subscription = nextSubscription;
        appendEvent(createReviewSessionEvent("session.invoke", "Starting Tauri review runtime."));
        return startReviewSession(request);
      })
      .then((result) => {
        if (cancelled || !result) return;
        appendEvent(createReviewSessionEvent("session.started", `Review session ${result.sessionId} started.`));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = formatUnknownError(error);
        completed = true;
        appendEvent(createReviewSessionEvent("review.failed", message, { error }));
        setPrepareState((current) => ({ ...current, status: "error", error: message }));
      });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [openReview, prepareRequest, prepareRunId]);

  return {
    activeSessionId,
    cancelPreparation,
    pendingSliceIds,
    prepareRequest,
    prepareState,
    resetPreparation,
    reviewPlan,
    reviewWorktree,
    startPreparation,
  };
}
