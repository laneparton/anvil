import { describe, expect, it } from "vitest";
import { collectFileOwnership, evaluateReviewPlan, type GoldenSpec, type ReviewPlan } from "./scorers";

const baseGolden: GoldenSpec = {
  pr: {
    repo: "repo/name",
    number: 1,
    title: "Add auth",
    url: "https://example.test/pr/1",
    baseRef: "main",
    headRef: "feature",
    headSha: "abc123",
    changedFiles: 3,
    additions: 10,
    deletions: 1,
  },
  files: [
    { path: "src/auth/createOAuthProvider.ts", category: "runtime" },
    { path: "src/resources/McpServerResource.ts", category: "runtime" },
    { path: "docs/readme.md", category: "docs" },
  ],
  requiredThemes: [
    {
      id: "oauth",
      title: "OAuth",
      anchorFiles: ["src/auth/createOAuthProvider.ts"],
      keywords: ["oauth", "state", "token"],
      minKeywordHits: 3,
    },
    {
      id: "lifecycle",
      title: "Lifecycle",
      anchorFiles: ["src/resources/McpServerResource.ts"],
      keywords: ["transport", "cleanup", "disconnect"],
      minKeywordHits: 3,
    },
  ],
  riskRanking: {
    highRiskFiles: ["src/auth/createOAuthProvider.ts", "src/resources/McpServerResource.ts"],
    lowValueFiles: ["docs/readme.md"],
  },
  evidenceQuality: {
    requiredAnchorFiles: ["src/auth/createOAuthProvider.ts", "src/resources/McpServerResource.ts"],
  },
  approvalSafety: {
    requiredConcerns: [
      { id: "auth-token-storage risk", keywords: ["token", "storage"] },
      { id: "transport lifecycle risk", keywords: ["transport", "cleanup"] },
    ],
  },
  thresholds: {
    maxPrimarySliceFiles: 2,
  },
};

const validPlan: ReviewPlan = {
  pr: baseGolden.pr,
  slices: [
    {
      id: "auth",
      title: "OAuth state and token storage",
      risk: "high",
      files: ["src/auth/createOAuthProvider.ts"],
      why: "OAuth state token storage risk",
      evidence: ["src/auth/createOAuthProvider.ts: checked OAuth state token storage"],
      acceptConditions: ["Accept if OAuth state and token storage are scoped."],
      commentConditions: ["Comment if OAuth state or token storage is unsafe."],
    },
    {
      id: "lifecycle",
      title: "Transport cleanup",
      risk: "high",
      files: ["src/resources/McpServerResource.ts"],
      why: "Transport cleanup disconnect risk",
      evidence: ["src/resources/McpServerResource.ts: checked transport cleanup disconnect"],
      acceptConditions: ["Accept if transport cleanup runs on disconnect."],
      commentConditions: ["Comment if transport cleanup is missing."],
      inlineComments: [
        {
          file: "src/resources/McpServerResource.ts",
          hunkId: "src/resources/McpServerResource.ts#h1",
          line: 12,
          body: "Check cleanup.",
        },
      ],
    },
    {
      id: "docs",
      title: "Docs",
      risk: "low",
      deferred: true,
      files: ["docs/readme.md"],
      evidence: ["docs/readme.md: support docs"],
    },
  ],
};

describe("review-plan deterministic scorers", () => {
  it("passes a minimal valid plan", () => {
    expect(evaluateReviewPlan(validPlan, baseGolden).verdict).toBe("pass");
  });

  it("detects duplicate file ownership", () => {
    const { duplicates } = collectFileOwnership({
      slices: [
        { id: "a", files: ["src/auth/createOAuthProvider.ts"] },
        { id: "b", files: ["src/auth/createOAuthProvider.ts"] },
      ],
    });

    expect(duplicates).toHaveLength(1);
  });

  it("fails when a required theme is missing", () => {
    const result = evaluateReviewPlan({ ...validPlan, slices: validPlan.slices?.slice(0, 1) }, baseGolden);
    expect(result.checks.find((check) => check.name === "requiredThemes")?.status).toBe("fail");
  });

  it("fails generic slice titles and oversized primary slices", () => {
    const result = evaluateReviewPlan(
      {
        ...validPlan,
        slices: [
          {
            id: "giant",
            title: "New package",
            risk: "high",
            files: ["src/auth/createOAuthProvider.ts", "src/resources/McpServerResource.ts", "docs/readme.md"],
          },
        ],
      },
      baseGolden,
    );

    const check = result.checks.find((item) => item.name === "sliceSize");
    expect(check?.status).toBe("fail");
    expect(check?.failures.join("\n")).toContain("generic title");
    expect(check?.failures.join("\n")).toContain("max is 2");
  });

  it("fails when low-value files outrank auth/resource code", () => {
    const result = evaluateReviewPlan(
      {
        ...validPlan,
        slices: [...(validPlan.slices ?? [])].reverse(),
      },
      baseGolden,
    );

    expect(result.checks.find((check) => check.name === "riskRanking")?.status).toBe("fail");
  });

  it("fails unanchored inline comments", () => {
    const result = evaluateReviewPlan(
      {
        ...validPlan,
        slices: [
          {
            ...validPlan.slices![0],
            inlineComments: [{ file: "src/auth/createOAuthProvider.ts", body: "Missing hunk and line." }],
          },
          validPlan.slices![1],
          validPlan.slices![2],
        ],
      },
      baseGolden,
    );

    expect(result.checks.find((check) => check.name === "inlineCommentAnchors")?.status).toBe("fail");
  });
});
