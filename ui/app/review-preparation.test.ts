import { describe, expect, it } from "vitest";
import {
  createPlannedReviewPlan,
  findInitialReviewSliceId,
  getPlannedSlices,
  mergeStreamingSlice,
  normalizeReviewPlan,
  orderPlannedSlices,
  type PendingPrepareRequest,
  type PlannedSlice,
} from "./review-preparation";
import { providerCommentsPlaceholder } from "@/lib/review-questions";
import type { ReviewPlan, Slice } from "@/lib/review-types";

const request: PendingPrepareRequest = {
  source: "github",
  repo: "owner/repo",
  pullRequest: "42",
  title: "Fix auth callback",
  url: "https://github.com/owner/repo/pull/42",
};

function slice(overrides: Partial<Slice> = {}): Slice {
  return {
    id: "base",
    title: "Base slice",
    risk: "medium",
    status: "needs-human",
    deferred: false,
    deferReason: "",
    why: "Base risk",
    files: ["src/base.ts"],
    filesReviewed: [],
    hunks: [],
    inlineComments: [],
    remainingQuestions: [],
    evidence: [],
    ...overrides,
  };
}

function plan(overrides: Partial<ReviewPlan> = {}): ReviewPlan {
  return {
    pr: {
      repo: "old/repo",
      number: 1,
      title: "Old title",
    },
    completion: {
      status: "needs-human",
      reviewedFiles: 0,
      totalFiles: 0,
      reviewedHunks: 0,
      totalHunks: 0,
      blockingComments: 0,
      openQuestions: 0,
    },
    slices: [],
    ...overrides,
  };
}

describe("review preparation helpers", () => {
  it("normalizes slices, filters placeholder questions, and orders active risk before deferred work", () => {
    const normalized = normalizeReviewPlan(
      plan({
        slices: [
          slice({ id: "docs", risk: "low", deferred: true, remainingQuestions: [providerCommentsPlaceholder] }),
          slice({ id: "auth", risk: "high", remainingQuestions: ["Does callback replay need a test?"] }),
        ],
      }),
    );

    expect(normalized.slices.map((item) => item.id)).toEqual(["auth", "docs"]);
    expect(normalized.slices[0].remainingQuestions).toEqual(["Does callback replay need a test?"]);
    expect(normalized.slices[1].remainingQuestions).toEqual([]);
    expect(normalized.slices[1].deferReason).toBe("");
  });

  it("filters planned slice payloads and orders them by risk", () => {
    const planned = getPlannedSlices({
      plannedSlices: [
        { id: "docs", title: "Docs", risk: "low", why: "Support", files: ["README.md"] },
        { id: "invalid", title: "Invalid", risk: "critical", why: "Bad", files: [] },
        { id: "auth", title: "Auth", risk: "high", why: "Callback", files: ["src/auth.ts"] },
      ],
    });

    expect(orderPlannedSlices(planned).map((item) => item.id)).toEqual(["auth", "docs"]);
  });

  it("creates a planned review plan from request identity", () => {
    const plannedSlices: PlannedSlice[] = [
      { id: "auth", title: "Auth", risk: "high", why: "Callback", files: ["src/auth.ts"] },
    ];
    const created = createPlannedReviewPlan(plan(), plannedSlices, request);

    expect(created.pr).toEqual({
      repo: "owner/repo",
      number: 42,
      title: "Fix auth callback",
      url: "https://github.com/owner/repo/pull/42",
    });
    expect(created.slices[0]).toMatchObject({
      id: "auth",
      status: "needs-human",
      deferred: false,
      filesReviewed: [],
      inlineComments: [],
    });
  });

  it("merges planner metadata without replacing streamed slice findings", () => {
    const streamed = slice({
      id: "auth",
      title: "Original streamed title",
      risk: "medium",
      files: ["src/auth.ts"],
      filesReviewed: ["src/auth.ts"],
      hunks: [{ file: "src/auth.ts", hunkId: "src/auth.ts#h1", reason: "Callback", lines: [] }],
      inlineComments: [
        {
          file: "src/auth.ts",
          hunkId: "src/auth.ts#h1",
          line: 42,
          severity: "blocking",
          body: "Guard duplicate redemption.",
        },
      ],
      remainingQuestions: ["Is replay covered?"],
      evidence: ["src/auth.ts:42"],
    });
    const created = createPlannedReviewPlan(
      plan({
        completion: {
          ...plan().completion,
          reviewedFiles: 1,
          reviewedHunks: 1,
          blockingComments: 1,
          openQuestions: 1,
        },
        slices: [streamed],
      }),
      [
        { id: "auth", title: "Auth callback", risk: "high", why: "Planner metadata", files: ["src/auth.ts"] },
        { id: "docs", title: "Docs", risk: "low", why: "Docs metadata", files: ["README.md"] },
      ],
      request,
    );

    const auth = created.slices.find((item) => item.id === "auth");
    expect(auth).toMatchObject({
      title: "Auth callback",
      risk: "high",
      why: "Planner metadata",
      filesReviewed: ["src/auth.ts"],
      evidence: ["src/auth.ts:42"],
    });
    expect(auth?.hunks).toHaveLength(1);
    expect(auth?.inlineComments).toHaveLength(1);
    expect(auth?.remainingQuestions).toEqual(["Is replay covered?"]);
  });

  it("merges streaming slices and recomputes completion counts", () => {
    const merged = mergeStreamingSlice(
      plan({ completion: { ...plan().completion, totalFiles: 1 } }),
      slice({
        id: "auth",
        risk: "high",
        files: ["src/auth.ts", "src/oauth.ts"],
        filesReviewed: ["src/auth.ts"],
        hunks: [{ file: "src/auth.ts", hunkId: "src/auth.ts#h1", reason: "Callback", lines: [] }],
        inlineComments: [
          {
            file: "src/auth.ts",
            hunkId: "src/auth.ts#h1",
            line: 42,
            severity: "blocking",
            body: "Guard duplicate callback redemption.",
          },
        ],
        remainingQuestions: [providerCommentsPlaceholder, "Is replay covered?"],
      }),
      request,
      false,
    );

    expect(merged.completion).toMatchObject({
      status: "blocked",
      reviewedFiles: 1,
      totalFiles: 2,
      reviewedHunks: 1,
      totalHunks: 1,
      blockingComments: 1,
      openQuestions: 1,
    });
  });

  it("starts review on the first slice with findings or questions", () => {
    const initialId = findInitialReviewSliceId(
      plan({
        slices: [
          slice({ id: "setup", risk: "high", inlineComments: [], remainingQuestions: [] }),
          slice({
            id: "auth",
            risk: "medium",
            inlineComments: [
              {
                file: "src/auth.ts",
                hunkId: "src/auth.ts#h1",
                line: 12,
                severity: "blocking",
                body: "Guard duplicate redemption.",
              },
            ],
            remainingQuestions: [],
          }),
        ],
      }),
    );

    expect(initialId).toBe("auth");
  });

  it("falls back to the first non-deferred slice when no slice has open work", () => {
    const initialId = findInitialReviewSliceId(
      plan({
        slices: [
          slice({ id: "docs", risk: "low", deferred: true }),
          slice({ id: "runtime", risk: "high", inlineComments: [], remainingQuestions: [] }),
        ],
      }),
    );

    expect(initialId).toBe("runtime");
  });
});
