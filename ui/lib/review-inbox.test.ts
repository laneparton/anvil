import { describe, expect, it } from "vitest";

import type { ReviewInboxRow } from "./api";
import {
  getReviewPullRequestNumber,
  mergeReviewInboxRows,
  normalizeReviewSource,
  providerTimeoutMs,
  reviewInboxRowKey,
  reviewInboxRowToPullRequest,
  sourceLabel,
} from "./review-inbox";

function row(overrides: Partial<ReviewInboxRow> = {}): ReviewInboxRow {
  return {
    source: "github",
    provider: "GitHub",
    repoId: "owner/repo",
    repoName: "repo",
    id: "PR_kwDO",
    number: 42,
    title: "Tighten review flow",
    author: "lane",
    age: "1h",
    files: 3,
    status: "open",
    needsReview: true,
    isCreatedByMe: false,
    isAssignedToMe: false,
    ...overrides,
  };
}

describe("review inbox helpers", () => {
  it("converts provider rows to launcher pull request rows", () => {
    const pullRequest = reviewInboxRowToPullRequest(row());

    expect(pullRequest).toMatchObject({
      id: "github:owner/repo:42",
      pullRequestId: "PR_kwDO",
      number: 42,
      repo: "owner/repo",
      repoId: "owner/repo",
      reviewStatus: "needsReview",
      needsReview: true,
    });
  });

  it("keys by source, repo, and number with id fallback", () => {
    expect(reviewInboxRowKey(row({ number: undefined, id: "7" }))).toBe("github:owner/repo:7");
  });

  it("normalizes source labels and provider timeout display values", () => {
    expect(normalizeReviewSource("Bitbucket Cloud")).toBe("bitbucket");
    expect(normalizeReviewSource("GitHub Enterprise")).toBe("github");
    expect(normalizeReviewSource("bitbucket-github")).toBeUndefined();
    expect(normalizeReviewSource("notgithub")).toBeUndefined();
    expect(normalizeReviewSource("gitlab")).toBeUndefined();
    expect(sourceLabel("github")).toBe("GitHub");
    expect(providerTimeoutMs("bitbucket")).toBe(15_000);
  });

  it("merges rows by id with newer rows winning", () => {
    const current = reviewInboxRowToPullRequest(row({ title: "Old title" }));
    const next = reviewInboxRowToPullRequest(row({ title: "New title" }));

    expect(mergeReviewInboxRows([current], [next])).toEqual([next]);
  });

  it("replaces stale cached rows with refreshed provider rows", () => {
    const cached = reviewInboxRowToPullRequest(row({ title: "Cached title", cacheStatus: "stale" }));
    const refreshed = reviewInboxRowToPullRequest(row({ title: "Fresh title", cacheStatus: "fresh" }));

    expect(mergeReviewInboxRows([cached], [refreshed])).toEqual([refreshed]);
  });

  it("resolves review pull request number from number, pullRequestId, or id", () => {
    expect(getReviewPullRequestNumber({ ...reviewInboxRowToPullRequest(row()), number: 42 })).toBe("42");
    expect(getReviewPullRequestNumber({ ...reviewInboxRowToPullRequest(row()), number: undefined })).toBe("PR_kwDO");
    expect(getReviewPullRequestNumber(undefined)).toBeUndefined();
  });
});
