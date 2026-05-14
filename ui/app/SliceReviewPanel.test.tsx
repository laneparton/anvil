import { describe, expect, it } from "vitest";

import { getDiffLineComment } from "./SliceReviewPanel";
import type { ReviewProgressComment } from "@/lib/review-progress";
import type { DiffLine } from "@/lib/review-types";

function comment(overrides: Partial<ReviewProgressComment> = {}): ReviewProgressComment {
  return {
    id: "comment-1",
    sliceId: "slice-1",
    file: "tests/test_migrations.py",
    hunkId: "tests/test_migrations.py#h1",
    line: 34,
    severity: "blocking",
    body: "Cover the real runner path.",
    decision: "open",
    draft: "",
    ...overrides,
  };
}

describe("getDiffLineComment", () => {
  it("renders one comment once when old and new sides share the same line number", () => {
    const commentsByLine = new Map([["34", [comment()]]]);
    const rendered = new Set<string>();
    const newLineNumbers = new Set([34]);
    const removedLine: DiffLine = { kind: "remove", oldNumber: 34, newNumber: null, text: "old import" };
    const addedLine: DiffLine = { kind: "add", oldNumber: null, newNumber: 34, text: "new import" };

    expect(getDiffLineComment(removedLine, commentsByLine, newLineNumbers, rendered)).toBeUndefined();
    expect(getDiffLineComment(addedLine, commentsByLine, newLineNumbers, rendered)?.id).toBe("comment-1");
    expect(getDiffLineComment(addedLine, commentsByLine, newLineNumbers, rendered)).toBeUndefined();
  });

  it("still renders comments anchored to deleted-only lines", () => {
    const commentsByLine = new Map([["12", [comment({ line: 12 })]]]);
    const removedLine: DiffLine = { kind: "remove", oldNumber: 12, newNumber: null, text: "removed" };

    expect(getDiffLineComment(removedLine, commentsByLine, new Set(), new Set())?.id).toBe("comment-1");
  });
});
