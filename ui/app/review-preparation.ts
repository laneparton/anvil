import type {
  PrepareReviewArtifacts,
  ReviewSessionEvent,
  ReviewSessionReadyData,
  StartReviewSessionRequest,
} from "@/lib/api";
import { filterActionableQuestions } from "@/lib/review-questions";
import type { ReviewPlan, Slice } from "@/lib/review-types";

export type LoadingState = "idle" | "loading" | "ready" | "error";

export type PrepareState = {
  status: LoadingState;
  error?: string;
  sessionId?: string;
  artifacts?: PrepareReviewArtifacts;
  events: ReviewSessionEvent[];
  canceling: boolean;
};

export type PendingPrepareRequest = Omit<StartReviewSessionRequest, "sessionId"> & {
  title?: string;
  url?: string;
};

export type PlannedSlice = Pick<Slice, "id" | "title" | "risk" | "why" | "files">;

export function createPrepareState(status: LoadingState): PrepareState {
  return {
    status,
    events: [],
    canceling: false,
  };
}

export function createReviewSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `review-${crypto.randomUUID()}`;
  }

  return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createReviewSessionEvent(type: string, message: string, data?: unknown): ReviewSessionEvent {
  return {
    type,
    message,
    at: new Date().toISOString(),
    data,
  };
}

export function normalizeReviewPlan(input: ReviewPlan): ReviewPlan {
  return {
    ...input,
    slices: orderReviewSlices(input.slices.map(normalizeSlice)),
  };
}

export function findInitialReviewSliceId(plan: ReviewPlan): string | undefined {
  const decisionSlice = plan.slices.find(hasOpenReviewWork);
  if (decisionSlice) {
    return decisionSlice.id;
  }

  return plan.slices.find((slice) => !slice.deferred)?.id ?? plan.slices[0]?.id;
}

export function hasOpenReviewWork(slice: Slice): boolean {
  return (
    !slice.deferred &&
    (slice.inlineComments.length > 0 || filterActionableQuestions(slice.remainingQuestions).length > 0)
  );
}

export function normalizeSlice(slice: Slice): Slice {
  return {
    ...slice,
    deferred: Boolean(slice.deferred),
    deferReason: typeof slice.deferReason === "string" ? slice.deferReason : "",
    remainingQuestions: filterActionableQuestions(slice.remainingQuestions),
  };
}

export function getReadySlice(data: unknown): Slice | undefined {
  if (typeof data !== "object" || data === null || !("slice" in data)) {
    return undefined;
  }

  const slice = (data as { slice?: unknown }).slice;
  if (
    typeof slice === "object" &&
    slice !== null &&
    "id" in slice &&
    "hunks" in slice &&
    Array.isArray((slice as { hunks?: unknown }).hunks)
  ) {
    return slice as Slice;
  }

  return undefined;
}

export function getPlannedSlices(data: unknown): PlannedSlice[] {
  if (typeof data !== "object" || data === null || !("plannedSlices" in data)) {
    return [];
  }

  const plannedSlices = (data as { plannedSlices?: unknown }).plannedSlices;
  if (!Array.isArray(plannedSlices)) {
    return [];
  }

  return plannedSlices.filter((slice): slice is PlannedSlice => {
    return (
      typeof slice === "object" &&
      slice !== null &&
      typeof (slice as { id?: unknown }).id === "string" &&
      typeof (slice as { title?: unknown }).title === "string" &&
      ((slice as { risk?: unknown }).risk === "high" ||
        (slice as { risk?: unknown }).risk === "medium" ||
        (slice as { risk?: unknown }).risk === "low") &&
      typeof (slice as { why?: unknown }).why === "string" &&
      Array.isArray((slice as { files?: unknown }).files)
    );
  });
}

export function createPlannedReviewPlan(
  current: ReviewPlan,
  plannedSlices: PlannedSlice[],
  request: PendingPrepareRequest,
  streamedSliceIds: ReadonlySet<string>,
): ReviewPlan {
  const slices = plannedSlices.map((plannedSlice) => {
    const existingSlice = streamedSliceIds.has(plannedSlice.id)
      ? current.slices.find((slice) => slice.id === plannedSlice.id)
      : undefined;
    if (!existingSlice) {
      return createPendingPlannedSlice(plannedSlice);
    }

    return normalizeSlice({
      ...existingSlice,
      id: plannedSlice.id,
      title: plannedSlice.title,
      risk: plannedSlice.risk,
      why: plannedSlice.why,
      files: plannedSlice.files,
    });
  });
  const completion = createCompletionForSlices(slices);

  return {
    ...current,
    pr: {
      repo: request.repo ?? current.pr.repo,
      number: Number(request.pullRequest) || current.pr.number,
      title: request.title || current.pr.title,
      url: request.url ?? current.pr.url,
    },
    completion,
    slices: orderReviewSlices(slices),
  };
}

function createPendingPlannedSlice(slice: PlannedSlice): Slice {
  return {
    ...slice,
    status: "needs-human",
    deferred: false,
    deferReason: "",
    filesReviewed: [],
    hunks: [],
    inlineComments: [],
    remainingQuestions: [],
    evidence: [],
  };
}

function createCompletionForSlices(slices: Slice[]): ReviewPlan["completion"] {
  const totalFiles = new Set(slices.flatMap((slice) => slice.files)).size;
  const reviewedFiles = new Set(slices.flatMap((slice) => slice.filesReviewed)).size;
  const reviewedHunks = slices.reduce((sum, slice) => sum + slice.hunks.length, 0);
  const blockingComments = slices.reduce(
    (sum, slice) => sum + slice.inlineComments.filter((comment) => comment.severity === "blocking").length,
    0,
  );
  const openQuestions = slices.reduce(
    (sum, slice) => sum + filterActionableQuestions(slice.remainingQuestions).length,
    0,
  );
  const hasPendingHumanWork = slices.some((slice) => slice.status === "needs-human");

  return {
    status:
      blockingComments > 0 ? "blocked" :
      openQuestions > 0 || hasPendingHumanWork ? "needs-human" :
      "agent-reviewed",
    reviewedFiles,
    totalFiles,
    reviewedHunks,
    totalHunks: reviewedHunks,
    blockingComments,
    openQuestions,
  };
}

export function mergeStreamingSlice(
  current: ReviewPlan,
  slice: Slice,
  request: PendingPrepareRequest,
  replaceExisting: boolean,
): ReviewPlan {
  const existingSlices = replaceExisting ? [] : current.slices;
  const slices = [...existingSlices.filter((candidate) => candidate.id !== slice.id), slice];
  const totalFiles = new Set(slices.flatMap((candidate) => candidate.files)).size;
  const reviewedFiles = new Set(slices.flatMap((candidate) => candidate.filesReviewed)).size;
  const reviewedHunks = slices.reduce((sum, candidate) => sum + candidate.hunks.length, 0);
  const blockingComments = slices.reduce(
    (sum, candidate) => sum + candidate.inlineComments.filter((comment) => comment.severity === "blocking").length,
    0,
  );
  const openQuestions = slices.reduce(
    (sum, candidate) => sum + filterActionableQuestions(candidate.remainingQuestions).length,
    0,
  );

  return {
    ...current,
    pr: {
      repo: request.repo ?? current.pr.repo,
      number: Number(request.pullRequest) || current.pr.number,
      title: request.title || current.pr.title,
      url: request.url ?? current.pr.url,
    },
    completion: {
      status: blockingComments > 0 ? "blocked" : openQuestions > 0 ? "needs-human" : "agent-reviewed",
      reviewedFiles,
      totalFiles: Math.max(totalFiles, current.completion.totalFiles),
      reviewedHunks,
      totalHunks: Math.max(reviewedHunks, current.completion.totalHunks),
      blockingComments,
      openQuestions,
    },
    slices: orderReviewSlices(slices),
  };
}

export function orderPlannedSlices(slices: PlannedSlice[]): PlannedSlice[] {
  return [...slices].sort((a, b) => {
    const riskDelta = riskRank(b.risk) - riskRank(a.risk);
    if (riskDelta !== 0) return riskDelta;
    return 0;
  });
}

export function isReviewSessionReadyData(data: unknown): data is ReviewSessionReadyData {
  return (
    typeof data === "object" &&
    data !== null &&
    "plan" in data &&
    typeof (data as { plan?: unknown }).plan === "object" &&
    (data as { plan?: unknown }).plan !== null
  );
}

export function findLatestReviewWorktree(events: ReviewSessionEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const directWorktree = getWorktreeFromUnknown(event);
    if (directWorktree) return directWorktree;

    const dataWorktree = getWorktreeFromUnknown(event.data);
    if (dataWorktree) return dataWorktree;
  }

  return undefined;
}

function orderReviewSlices(slices: Slice[]): Slice[] {
  return [...slices].sort((a, b) => {
    if (a.deferred !== b.deferred) return a.deferred ? 1 : -1;
    const riskDelta = riskRank(b.risk) - riskRank(a.risk);
    if (riskDelta !== 0) return riskDelta;
    return 0;
  });
}

function riskRank(risk: Slice["risk"]) {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function getWorktreeFromUnknown(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.worktree === "string") {
    return record.worktree;
  }

  if (typeof record.artifacts === "object" && record.artifacts !== null) {
    const artifacts = record.artifacts as Record<string, unknown>;
    if (typeof artifacts.worktree === "string") {
      return artifacts.worktree;
    }
  }

  return undefined;
}
