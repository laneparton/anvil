import { describe, expect, it } from "vitest";
import { createReviewProgressSnapshot, type ReviewProgressState } from "./review-progress";
import type { Slice } from "./review-types";

function slice(overrides: Partial<Slice> = {}): Slice {
  return {
    id: "auth",
    title: "Auth callbacks",
    risk: "high",
    status: "needs-human",
    deferred: false,
    deferReason: "",
    why: "OAuth callback risk",
    files: ["src/auth.ts"],
    filesReviewed: ["src/auth.ts"],
    hunks: [],
    inlineComments: [
      {
        file: "src/auth.ts",
        hunkId: "src/auth.ts#h1",
        line: 42,
        severity: "blocking",
        body: "Guard duplicate OAuth callback redemption.",
      },
    ],
    remainingQuestions: [],
    evidence: ["src/auth.ts: checked callback"],
    ...overrides,
  };
}

describe("createReviewProgressSnapshot", () => {
  it("counts reviewed slices and open comments without React state", () => {
    const snapshot = createReviewProgressSnapshot([
      slice(),
      slice({ id: "docs", title: "Docs", risk: "low", files: ["README.md"], inlineComments: [] }),
    ]);

    expect(snapshot.counts).toMatchObject({
      totalSlices: 2,
      reviewedSlices: 0,
      unreviewedSlices: 2,
      totalComments: 1,
      openComments: 1,
      percentReviewed: 0,
    });
    expect(snapshot.comments[0]).toMatchObject({
      sliceId: "auth",
      decision: "open",
      draft: "",
    });
  });

  it("applies comment decisions, drafts, and queued comment filtering", () => {
    const initial = createReviewProgressSnapshot([slice()]);
    const commentId = initial.comments[0].id;
    const state: ReviewProgressState = {
      reviewedSliceIds: ["auth"],
      commentDecisions: {
        [commentId]: "converted",
      },
      commentDrafts: {
        [commentId]: "Please add a test for Strict Mode callback replay.",
      },
    };
    const snapshot = createReviewProgressSnapshot([slice()], state);

    expect(snapshot.counts).toMatchObject({
      reviewedSlices: 1,
      openComments: 0,
      convertedComments: 1,
      actionedComments: 1,
      remainingComments: 0,
      percentReviewed: 100,
    });
    expect(snapshot.queuedComments).toHaveLength(1);
    expect(snapshot.queuedComments[0].draft).toBe("Please add a test for Strict Mode callback replay.");
  });
});
