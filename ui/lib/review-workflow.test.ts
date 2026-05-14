import { describe, expect, it } from "vitest";

import type { ReviewProgressComment, ReviewProgressSlice } from "./review-progress";
import { countOpenQuestions, findNextReviewSlice, groupComments, groupHunksByFile } from "./review-workflow";

function comment(overrides: Partial<ReviewProgressComment> = {}): ReviewProgressComment {
  return {
    id: "comment-1",
    sliceId: "slice-1",
    file: "src/app.ts",
    hunkId: "src/app.ts#h1",
    line: 10,
    severity: "blocking",
    body: "Add a guard.",
    decision: "open",
    draft: "",
    ...overrides,
  };
}

function slice(overrides: Partial<ReviewProgressSlice> = {}): ReviewProgressSlice {
  return {
    id: "slice-1",
    title: "App flow",
    risk: "medium",
    status: "needs-human",
    deferred: false,
    deferReason: "",
    why: "Review app flow.",
    files: ["src/app.ts"],
    filesReviewed: ["src/app.ts"],
    hunks: [],
    inlineComments: [],
    remainingQuestions: [],
    evidence: [],
    reviewed: false,
    comments: [],
    counts: {
      totalComments: 0,
      openComments: 0,
      resolvedComments: 0,
      dismissedComments: 0,
      convertedComments: 0,
      actionedComments: 0,
      remainingComments: 0,
    },
    ...overrides,
  };
}

describe("review workflow helpers", () => {
  it("groups comments by hunk id", () => {
    const grouped = groupComments([
      comment({ id: "a", hunkId: "src/app.ts#h1" }),
      comment({ id: "b", hunkId: "src/app.ts#h1" }),
      comment({ id: "c", hunkId: "src/app.ts#h2" }),
    ]);

    expect(grouped.get("src/app.ts#h1")?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(grouped.get("src/app.ts#h2")?.map((item) => item.id)).toEqual(["c"]);
  });

  it("groups hunks by file and sorts files with findings first", () => {
    const grouped = groupHunksByFile(
      [
        { file: "src/clean.ts", hunkId: "src/clean.ts#h1", reason: "", lines: [] },
        { file: "src/app.ts", hunkId: "src/app.ts#h1", reason: "", lines: [] },
      ],
      groupComments([comment({ hunkId: "src/app.ts#h1" })]),
    );

    expect(grouped).toMatchObject([
      { file: "src/app.ts", commentCount: 1 },
      { file: "src/clean.ts", commentCount: 0 },
    ]);
  });

  it("selects the next unreviewed slice with work remaining", () => {
    const next = findNextReviewSlice(
      [
        slice({ id: "slice-1", reviewed: true }),
        slice({ id: "slice-2", comments: [] }),
        slice({ id: "slice-3", comments: [comment({ id: "open", sliceId: "slice-3" })] }),
      ],
      "slice-1",
      new Set(["slice-1"]),
    );

    expect(next?.id).toBe("slice-3");
  });

  it("counts actionable open questions only on unreviewed slices", () => {
    expect(
      countOpenQuestions([
        slice({ remainingQuestions: ["Check deploy evidence."], reviewed: false }),
        slice({
          id: "slice-2",
          remainingQuestions: ["No provider comments have been generated yet. Review the prepared diff slice."],
          reviewed: false,
        }),
        slice({ id: "slice-3", remainingQuestions: ["Check tests."], reviewed: true }),
      ]),
    ).toBe(1);
  });
});
