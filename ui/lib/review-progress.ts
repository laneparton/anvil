import { useCallback, useEffect, useMemo, useState } from "react";
import { filterActionableQuestions } from "./review-questions";
import type { InlineComment, ReviewPlan, Slice } from "./review-types";

export type CommentDecision = "open" | "resolved" | "dismissed" | "converted";

export type ReviewProgressState = {
  reviewedSliceIds: string[];
  deferredSliceIds: string[];
  commentDecisions: Record<string, CommentDecision>;
  commentDrafts: Record<string, string>;
};

export type ReviewProgressCounts = {
  totalSlices: number;
  reviewedSlices: number;
  unreviewedSlices: number;
  totalComments: number;
  openComments: number;
  resolvedComments: number;
  dismissedComments: number;
  convertedComments: number;
  actionedComments: number;
  remainingComments: number;
  percentReviewed: number;
};

export type ReviewProgressComment = InlineComment & {
  id: string;
  sliceId: string;
  decision: CommentDecision;
  draft: string;
};

export type ReviewProgressSlice = Slice & {
  reviewed: boolean;
  comments: ReviewProgressComment[];
  counts: Pick<
    ReviewProgressCounts,
    | "totalComments"
    | "openComments"
    | "resolvedComments"
    | "dismissedComments"
    | "convertedComments"
    | "actionedComments"
    | "remainingComments"
  >;
};

export type UseReviewProgressOptions = {
  storageKey?: string;
  initialState?: Partial<ReviewProgressState>;
};

export type UseReviewProgressResult = {
  state: ReviewProgressState;
  slices: ReviewProgressSlice[];
  comments: ReviewProgressComment[];
  queuedComments: ReviewProgressComment[];
  counts: ReviewProgressCounts;
  isSliceReviewed: (sliceId: string) => boolean;
  getCommentDecision: (commentId: string) => CommentDecision;
  setSliceReviewed: (sliceId: string, reviewed: boolean) => void;
  setSliceDeferred: (sliceId: string, deferred: boolean) => void;
  toggleSliceReviewed: (sliceId: string) => void;
  markAllSlicesReviewed: () => void;
  resetReviewedSlices: () => void;
  setCommentDecision: (commentId: string, decision: CommentDecision) => void;
  resetCommentDecision: (commentId: string) => void;
  setCommentDraft: (commentId: string, draft: string) => void;
  resetCommentDraft: (commentId: string) => void;
  clearProgress: () => void;
};

export type ReviewProgressSnapshot = Pick<
  UseReviewProgressResult,
  "slices" | "comments" | "queuedComments" | "counts"
>;

const DEFAULT_STORAGE_KEY = "review-progress";
const COMMENT_DECISIONS: CommentDecision[] = [
  "open",
  "resolved",
  "dismissed",
  "converted",
];

function isReviewPlan(input: ReviewPlan | Slice[]): input is ReviewPlan {
  return !Array.isArray(input);
}

function getSlices(input: ReviewPlan | Slice[]): Slice[] {
  return isReviewPlan(input) ? input.slices : input;
}

function createEmptyState(): ReviewProgressState {
  return {
    reviewedSliceIds: [],
    deferredSliceIds: [],
    commentDecisions: {},
    commentDrafts: {},
  };
}

function mergeState(
  base: ReviewProgressState,
  next?: Partial<ReviewProgressState>,
): ReviewProgressState {
  return {
    reviewedSliceIds: next?.reviewedSliceIds ?? base.reviewedSliceIds,
    deferredSliceIds: next?.deferredSliceIds ?? base.deferredSliceIds,
    commentDecisions: next?.commentDecisions ?? base.commentDecisions,
    commentDrafts: next?.commentDrafts ?? base.commentDrafts,
  };
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredState(storageKey: string): ReviewProgressState | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ReviewProgressState>;

    return sanitizeState(parsed);
  } catch {
    return null;
  }
}

function writeStoredState(storageKey: string, state: ReviewProgressState) {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function sanitizeState(input: Partial<ReviewProgressState>): ReviewProgressState {
  const reviewedSliceIds = Array.isArray(input.reviewedSliceIds)
    ? input.reviewedSliceIds.filter((id): id is string => typeof id === "string")
    : [];
  const deferredSliceIds = Array.isArray(input.deferredSliceIds)
    ? input.deferredSliceIds.filter((id): id is string => typeof id === "string")
    : [];
  const commentDecisions = Object.fromEntries(
    Object.entries(input.commentDecisions ?? {}).filter(
      (entry): entry is [string, CommentDecision] =>
        typeof entry[0] === "string" &&
        COMMENT_DECISIONS.includes(entry[1] as CommentDecision),
    ),
  );
  const commentDrafts = Object.fromEntries(
    Object.entries(input.commentDrafts ?? {}).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    ),
  );

  return {
    reviewedSliceIds,
    deferredSliceIds,
    commentDecisions,
    commentDrafts,
  };
}

function normalizeState(
  state: ReviewProgressState,
  sliceIds: Set<string>,
  commentIds: Set<string>,
): ReviewProgressState {
  return {
    reviewedSliceIds: state.reviewedSliceIds.filter((id) => sliceIds.has(id)),
    deferredSliceIds: state.deferredSliceIds.filter((id) => sliceIds.has(id)),
    commentDecisions: Object.fromEntries(
      Object.entries(state.commentDecisions).filter(([id]) => commentIds.has(id)),
    ),
    commentDrafts: Object.fromEntries(
      Object.entries(state.commentDrafts).filter(([id]) => commentIds.has(id)),
    ),
  };
}

function markActionedSlicesReviewed(
  state: ReviewProgressState,
  slices: Slice[],
): ReviewProgressState {
  const reviewedSliceIds = new Set(state.reviewedSliceIds);
  let changed = false;

  for (const slice of slices) {
    if (slice.inlineComments.length === 0 || filterActionableQuestions(slice.remainingQuestions).length > 0) {
      continue;
    }

    const hasOpenComment = slice.inlineComments.some((comment, index) => {
      const commentId = createCommentId(slice, comment, index);
      return (state.commentDecisions[commentId] ?? "open") === "open";
    });

    if (!hasOpenComment && !reviewedSliceIds.has(slice.id)) {
      reviewedSliceIds.add(slice.id);
      changed = true;
    }
  }

  if (!changed) {
    return state;
  }

  return {
    ...state,
    reviewedSliceIds: Array.from(reviewedSliceIds),
  };
}

function createCommentId(
  slice: Slice,
  comment: InlineComment,
  index: number,
): string {
  return [
    slice.id,
    comment.file,
    comment.hunkId,
    String(comment.line),
    comment.severity,
    index,
    hashString(comment.body),
  ]
    .map(encodeURIComponent)
    .join(":");
}

function hashString(input: string) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function countComments(comments: ReviewProgressComment[]) {
  const resolvedComments = comments.filter(
    (comment) => comment.decision === "resolved",
  ).length;
  const dismissedComments = comments.filter(
    (comment) => comment.decision === "dismissed",
  ).length;
  const convertedComments = comments.filter(
    (comment) => comment.decision === "converted",
  ).length;
  const openComments = comments.filter((comment) => comment.decision === "open").length;
  const actionedComments = resolvedComments + dismissedComments + convertedComments;

  return {
    totalComments: comments.length,
    openComments,
    resolvedComments,
    dismissedComments,
    convertedComments,
    actionedComments,
    remainingComments: openComments,
  };
}

export function createReviewProgressSnapshot(
  input: ReviewPlan | Slice[],
  state: ReviewProgressState = createEmptyState(),
): ReviewProgressSnapshot {
  const rawSlices = getSlices(input);
  const reviewedSliceIdSet = new Set(state.reviewedSliceIds);
  const deferredSliceIdSet = new Set(state.deferredSliceIds);
  const slices = rawSlices.map((slice) => {
    const comments = slice.inlineComments.map((comment, index) => {
      const id = createCommentId(slice, comment, index);

      return {
        ...comment,
        id,
        sliceId: slice.id,
        decision: state.commentDecisions[id] ?? "open",
        draft: state.commentDrafts[id] ?? "",
      };
    });

    return {
      ...slice,
      deferred: slice.deferred || deferredSliceIdSet.has(slice.id),
      reviewed: reviewedSliceIdSet.has(slice.id),
      comments,
      counts: countComments(comments),
    };
  });
  const comments = slices.flatMap((slice) => slice.comments);
  const queuedComments = comments.filter((comment) => comment.decision === "converted");
  const commentCounts = countComments(comments);
  const reviewedSlices = slices.filter((slice) => slice.reviewed).length;
  const totalSlices = slices.length;

  return {
    slices,
    comments,
    queuedComments,
    counts: {
      totalSlices,
      reviewedSlices,
      unreviewedSlices: totalSlices - reviewedSlices,
      ...commentCounts,
      percentReviewed:
        totalSlices === 0 ? 0 : Math.round((reviewedSlices / totalSlices) * 100),
    },
  };
}

export function useReviewProgress(
  input: ReviewPlan | Slice[],
  options: UseReviewProgressOptions = {},
): UseReviewProgressResult {
  const { storageKey = DEFAULT_STORAGE_KEY, initialState } = options;
  const rawSlices = getSlices(input);
  const [state, setState] = useState<ReviewProgressState>(() =>
    mergeState(readStoredState(storageKey) ?? createEmptyState(), initialState),
  );

  const commentIds = useMemo(() => {
    return rawSlices.flatMap((slice) =>
      slice.inlineComments.map((comment, index) =>
        createCommentId(slice, comment, index),
      ),
    );
  }, [rawSlices]);

  const sliceIdSet = useMemo(
    () => new Set(rawSlices.map((slice) => slice.id)),
    [rawSlices],
  );
  const commentIdSet = useMemo(() => new Set(commentIds), [commentIds]);

  useEffect(() => {
    setState((current) => normalizeState(current, sliceIdSet, commentIdSet));
  }, [commentIdSet, sliceIdSet]);

  useEffect(() => {
    setState((current) => markActionedSlicesReviewed(current, rawSlices));
  }, [rawSlices, state.commentDecisions]);

  useEffect(() => {
    writeStoredState(storageKey, state);
  }, [state, storageKey]);

  const { slices, comments, queuedComments, counts } = useMemo(
    () => createReviewProgressSnapshot(rawSlices, state),
    [rawSlices, state],
  );

  const reviewedSliceIdSet = useMemo(
    () => new Set(state.reviewedSliceIds),
    [state.reviewedSliceIds],
  );

  const isSliceReviewed = useCallback(
    (sliceId: string) => reviewedSliceIdSet.has(sliceId),
    [reviewedSliceIdSet],
  );

  const getCommentDecision = useCallback(
    (commentId: string) => state.commentDecisions[commentId] ?? "open",
    [state.commentDecisions],
  );

  const setSliceReviewed = useCallback((sliceId: string, reviewed: boolean) => {
    setState((current) => {
      const reviewedSliceIds = new Set(current.reviewedSliceIds);

      if (reviewed) {
        reviewedSliceIds.add(sliceId);
      } else {
        reviewedSliceIds.delete(sliceId);
      }

      return {
        ...current,
        reviewedSliceIds: Array.from(reviewedSliceIds),
      };
    });
  }, []);

  const setSliceDeferred = useCallback((sliceId: string, deferred: boolean) => {
    setState((current) => {
      const deferredSliceIds = new Set(current.deferredSliceIds);

      if (deferred) {
        deferredSliceIds.add(sliceId);
      } else {
        deferredSliceIds.delete(sliceId);
      }

      return {
        ...current,
        deferredSliceIds: Array.from(deferredSliceIds),
      };
    });
  }, []);

  const toggleSliceReviewed = useCallback((sliceId: string) => {
    setState((current) => {
      const reviewedSliceIds = new Set(current.reviewedSliceIds);

      if (reviewedSliceIds.has(sliceId)) {
        reviewedSliceIds.delete(sliceId);
      } else {
        reviewedSliceIds.add(sliceId);
      }

      return {
        ...current,
        reviewedSliceIds: Array.from(reviewedSliceIds),
      };
    });
  }, []);

  const markAllSlicesReviewed = useCallback(() => {
    setState((current) => ({
      ...current,
      reviewedSliceIds: rawSlices.map((slice) => slice.id),
    }));
  }, [rawSlices]);

  const resetReviewedSlices = useCallback(() => {
    setState((current) => ({
      ...current,
      reviewedSliceIds: [],
    }));
  }, []);

  const setCommentDecision = useCallback(
    (commentId: string, decision: CommentDecision) => {
      setState((current) => {
        const nextDecisions = { ...current.commentDecisions };

        if (decision === "open") {
          delete nextDecisions[commentId];
        } else {
          nextDecisions[commentId] = decision;
        }

        return {
          ...current,
          commentDecisions: nextDecisions,
        };
      });
    },
    [],
  );

  const resetCommentDecision = useCallback((commentId: string) => {
    setState((current) => {
      const nextDecisions = { ...current.commentDecisions };
      delete nextDecisions[commentId];

      return {
        ...current,
        commentDecisions: nextDecisions,
      };
    });
  }, []);

  const setCommentDraft = useCallback((commentId: string, draft: string) => {
    setState((current) => ({
      ...current,
      commentDrafts: {
        ...current.commentDrafts,
        [commentId]: draft,
      },
    }));
  }, []);

  const resetCommentDraft = useCallback((commentId: string) => {
    setState((current) => {
      const nextDrafts = { ...current.commentDrafts };
      delete nextDrafts[commentId];

      return {
        ...current,
        commentDrafts: nextDrafts,
      };
    });
  }, []);

  const clearProgress = useCallback(() => {
    setState(createEmptyState());
  }, []);

  return {
    state,
    slices,
    comments,
    queuedComments,
    counts,
    isSliceReviewed,
    getCommentDecision,
    setSliceReviewed,
    setSliceDeferred,
    toggleSliceReviewed,
    markAllSlicesReviewed,
    resetReviewedSlices,
    setCommentDecision,
    resetCommentDecision,
    setCommentDraft,
    resetCommentDraft,
    clearProgress,
  };
}
