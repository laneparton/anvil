import fs from "node:fs/promises";

export type ReviewPlanRisk = "high" | "medium" | "low" | string;

export type ReviewPlanSlice = {
  id?: string;
  title?: string;
  risk?: ReviewPlanRisk;
  deferred?: boolean;
  why?: string;
  files?: string[];
  hunks?: Array<{ file?: string; hunkId?: string; reason?: string; line?: number | string }>;
  inlineComments?: Array<{ file?: string; hunkId?: string; line?: number | string; body?: string }>;
  evidence?: string[];
  remainingQuestions?: string[];
  acceptConditions?: string[];
  commentConditions?: string[];
  suggestedDecision?: string;
};

export type ReviewPlan = {
  pr?: {
    repo?: string;
    number?: number;
    title?: string;
    url?: string;
    baseRef?: string;
    headRef?: string;
    headSha?: string;
    changedFiles?: number;
    additions?: number;
    deletions?: number;
  };
  slices?: ReviewPlanSlice[];
  hiddenGroups?: Array<{ id?: string; title?: string; files?: string[] }>;
  fallbackFileList?: string[];
};

export type GoldenSpec = {
  pr: Required<NonNullable<ReviewPlan["pr"]>>;
  files: Array<{ path: string; category: string }>;
  requiredThemes: Array<{
    id: string;
    title: string;
    anchorFiles: string[];
    keywords: string[];
    minKeywordHits?: number;
    requiresActionability?: boolean;
  }>;
  riskRanking: {
    highRiskFiles: string[];
    lowValueFiles: string[];
  };
  evidenceQuality: {
    requiredAnchorFiles: string[];
  };
  approvalSafety: {
    requiredConcerns: Array<{ id: string; keywords: string[] }>;
  };
  thresholds?: {
    deterministicPassScore?: number;
    judgePassScore?: number;
    maxPrimarySliceFiles?: number;
  };
};

export type ReviewPlanEvalInput = {
  caseId: string;
  candidatePath: string;
};

export type CheckResult = {
  name: string;
  status: "pass" | "fail";
  score: number;
  weight: number;
  failures: string[];
  evidence: string[];
};

export type ReviewPlanEvalResult = {
  verdict: "pass" | "fail";
  deterministicScore: number;
  judgeScore: number;
  checks: CheckResult[];
  judge: {
    mode: "offline-contract-proxy" | "json-file";
    scores: {
      semanticSlicing: number;
      riskPrioritization: number;
      reviewerUsefulness: number;
      evidenceQuality: number;
      approvalSafety: number;
    };
    missingConcerns: string[];
    unsupportedClaims: string[];
    verdict: "pass" | "fail";
    shortRationale: string;
  };
  summary: string;
};

const DEFAULT_THRESHOLDS = {
  deterministicPassScore: 0.85,
  judgePassScore: 0.8,
  maxPrimarySliceFiles: 18,
};

const CHECK_WEIGHTS: Record<string, number> = {
  identity: 1,
  coverage: 3,
  requiredThemes: 3,
  sliceSize: 1,
  riskRanking: 2,
  actionability: 2,
  evidenceQuality: 2,
  approvalSafety: 2,
  inlineCommentAnchors: 1,
};

export async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await fs.readFile(path, "utf8")) as T;
}

export function evaluateReviewPlan(candidate: ReviewPlan, golden: GoldenSpec, judgeOverride?: ReviewPlanEvalResult["judge"]): ReviewPlanEvalResult {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(golden.thresholds ?? {}) };
  const checks = [
    checkIdentity(candidate, golden),
    checkCoverage(candidate, golden),
    checkRequiredThemes(candidate, golden),
    checkSliceSize(candidate, thresholds.maxPrimarySliceFiles),
    checkRiskRanking(candidate, golden),
    checkActionability(candidate, golden),
    checkEvidenceQuality(candidate, golden),
    checkApprovalSafety(candidate, golden),
    checkInlineCommentAnchors(candidate),
  ];

  const possible = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + check.score * check.weight, 0);
  const deterministicScore = round(earned / possible);
  const judge = judgeOverride ?? buildOfflineJudgeProxy(candidate, golden, checks);
  const judgeScore = round(average(Object.values(judge.scores)));
  const verdict =
    deterministicScore >= thresholds.deterministicPassScore &&
    checks.every((check) => check.status === "pass") &&
    judge.verdict === "pass" &&
    judgeScore >= thresholds.judgePassScore
      ? "pass"
      : "fail";

  return {
    verdict,
    deterministicScore,
    judgeScore,
    checks,
    judge,
    summary: summarize(verdict, deterministicScore, judgeScore, checks),
  };
}

export function collectFileOwnership(candidate: ReviewPlan) {
  const ownership = new Map<string, { kind: string; id: string; title: string; risk: string; deferred: boolean }>();
  const duplicates: Array<{ file: string; owners: string[] }> = [];

  const add = (file: unknown, owner: { kind: string; id: string; title: string; risk: string; deferred: boolean }) => {
    if (typeof file !== "string" || file.length === 0) return;
    const existing = ownership.get(file);
    if (existing) {
      duplicates.push({ file, owners: [existing.id, owner.id] });
      return;
    }
    ownership.set(file, owner);
  };

  for (const [index, slice] of asArray(candidate.slices).entries()) {
    for (const file of asArray(slice.files)) {
      add(file, {
        kind: "slice",
        id: slice.id ?? `slice-${index}`,
        title: slice.title ?? "",
        risk: String(slice.risk ?? "unknown"),
        deferred: Boolean(slice.deferred),
      });
    }
  }

  for (const [index, group] of asArray(candidate.hiddenGroups).entries()) {
    for (const file of asArray(group.files)) {
      add(file, {
        kind: "hiddenGroup",
        id: group.id ?? `hidden-${index}`,
        title: group.title ?? "",
        risk: "low",
        deferred: true,
      });
    }
  }

  for (const [index, file] of asArray(candidate.fallbackFileList).entries()) {
    if (typeof file === "string" && ownership.has(file)) continue;
    add(file, {
      kind: "fallback",
      id: `fallback-${index}`,
      title: "fallbackFileList",
      risk: "unknown",
      deferred: true,
    });
  }

  return { ownership, duplicates };
}

export function buildJudgePrompt(candidate: ReviewPlan, golden: GoldenSpec) {
  return {
    instruction:
      "Grade the candidate review plan against the golden expectations. Return strict JSON only. Every criticism must cite a candidate slice, file, hunk, or golden expectation. Do not fail for phrasing differences.",
    outputSchema: {
      scores: {
        semanticSlicing: "0..1",
        riskPrioritization: "0..1",
        reviewerUsefulness: "0..1",
        evidenceQuality: "0..1",
        approvalSafety: "0..1",
      },
      missingConcerns: ["string"],
      unsupportedClaims: ["string"],
      verdict: "pass | fail",
      shortRationale: "string",
    },
    pr: golden.pr,
    changedFiles: golden.files.map((file) => file.path),
    goldenExpectations: golden,
    candidate,
  };
}

function checkIdentity(candidate: ReviewPlan, golden: GoldenSpec): CheckResult {
  const failures: string[] = [];
  const actual = candidate.pr ?? {};
  const expected = golden.pr;
  const fields: Array<keyof typeof expected> = ["repo", "number", "title", "url", "baseRef", "headRef", "headSha", "changedFiles", "additions", "deletions"];

  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      failures.push(`pr.${field} expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(actual[field])}`);
    }
  }

  return check("identity", failures, [`${expected.repo}#${expected.number}`, `head ${expected.headSha}`]);
}

function checkCoverage(candidate: ReviewPlan, golden: GoldenSpec): CheckResult {
  const expectedFiles = golden.files.map((file) => file.path);
  const expected = new Set(expectedFiles);
  const { ownership, duplicates } = collectFileOwnership(candidate);
  const missing = expectedFiles.filter((file) => !ownership.has(file));
  const unknown = Array.from(ownership.keys()).filter((file) => !expected.has(file));
  const failures: string[] = [];

  if (missing.length > 0) failures.push(`missing files: ${formatList(missing)}`);
  if (duplicates.length > 0) failures.push(`duplicate file ownership: ${formatList(duplicates.map((entry) => entry.file))}`);
  if (unknown.length > 0) failures.push(`unknown files outside golden diff: ${formatList(unknown)}`);

  return check("coverage", failures, [`owned ${ownership.size}/${expectedFiles.length} files exactly once`]);
}

function checkRequiredThemes(candidate: ReviewPlan, golden: GoldenSpec): CheckResult {
  const failures: string[] = [];
  const evidence: string[] = [];
  const matchedThemeBySlice = new Map<string, string>();

  for (const theme of golden.requiredThemes) {
    const matches = matchingSlices(candidate, theme);
    if (matches.length === 0) failures.push(`missing review area ${theme.id}: ${theme.title}`);
    else {
      const firstMatch = matches[0];
      const sliceId = firstMatch.id ?? firstMatch.title ?? "unknown-slice";
      const existingTheme = matchedThemeBySlice.get(sliceId);
      if (existingTheme) {
        failures.push(`review areas ${existingTheme} and ${theme.id} are not separated; both match ${sliceId}`);
      }
      matchedThemeBySlice.set(sliceId, theme.id);
      evidence.push(`${theme.id}: ${matches.map((slice) => slice.id ?? slice.title).join(", ")}`);
    }
  }

  return check("requiredThemes", failures, evidence);
}

function checkSliceSize(candidate: ReviewPlan, maxPrimarySliceFiles: number): CheckResult {
  const failures: string[] = [];
  const evidence: string[] = [];

  for (const [index, slice] of asArray(candidate.slices).entries()) {
    const files = asArray(slice.files);
    const id = slice.id ?? `slice-${index}`;
    if (!slice.deferred && files.length > maxPrimarySliceFiles) {
      failures.push(`${id} owns ${files.length} primary files; max is ${maxPrimarySliceFiles}`);
    }
    if (isGenericSliceTitle(slice.title ?? "")) {
      failures.push(`${id} has generic title ${JSON.stringify(slice.title)}`);
    }
    evidence.push(`${id}: ${files.length} file(s)`);
  }

  return check("sliceSize", failures, evidence);
}

function checkRiskRanking(candidate: ReviewPlan, golden: GoldenSpec): CheckResult {
  const { ownership } = collectFileOwnership(candidate);
  const slices = asArray(candidate.slices);
  const highRisk = new Set(golden.riskRanking.highRiskFiles);
  const lowValue = new Set(golden.riskRanking.lowValueFiles);
  const highRiskIndexes = indexesWithFiles(slices, highRisk);
  const lowValueIndexes = indexesWithFiles(slices, lowValue);
  const failures: string[] = [];
  const evidence: string[] = [];

  if (lowValueIndexes.length > 0 && highRiskIndexes.length > 0 && Math.min(...lowValueIndexes) < Math.max(...highRiskIndexes)) {
    failures.push("low-value support material is ranked before all high-risk auth/resource slices");
  }

  for (const file of highRisk) {
    const owner = ownership.get(file);
    if (!owner) continue;
    if (!["high", "medium"].includes(owner.risk)) failures.push(`${file} is ranked ${owner.risk} in ${owner.id}`);
    if (owner.kind !== "slice") failures.push(`${file} is not in a primary review slice`);
    evidence.push(`${file}: ${owner.id} (${owner.risk})`);
  }

  return check("riskRanking", failures, evidence);
}

function checkActionability(candidate: ReviewPlan, golden: GoldenSpec): CheckResult {
  const failures: string[] = [];
  const evidence: string[] = [];

  for (const theme of golden.requiredThemes.filter((item) => item.requiresActionability !== false)) {
    const matches = matchingSlices(candidate, theme);
    if (matches.length === 0) continue;
    if (!matches.some(hasAcceptAndCommentConditions)) {
      failures.push(`${theme.id} lacks accept and comment conditions`);
    } else {
      evidence.push(`${theme.id}: accept/comment conditions present`);
    }
  }

  return check("actionability", failures, evidence);
}

function checkEvidenceQuality(candidate: ReviewPlan, golden: GoldenSpec): CheckResult {
  const fullText = normalizedText(candidate);
  const failures: string[] = [];
  const evidence: string[] = [];

  for (const anchor of golden.evidenceQuality.requiredAnchorFiles) {
    if (!fullText.includes(anchor.toLowerCase())) failures.push(`missing anchor ${anchor}`);
    else evidence.push(anchor);
  }

  const genericEvidence = asArray(candidate.slices)
    .flatMap((slice) => asArray(slice.evidence).map((entry) => ({ id: slice.id ?? slice.title ?? "slice", entry })))
    .filter(({ entry }) => isGenericEvidence(entry));
  if (genericEvidence.length > 0) {
    failures.push(`generic evidence entries: ${formatList(genericEvidence.map((item) => `${item.id}: ${item.entry}`), 4)}`);
  }

  return check("evidenceQuality", failures, evidence);
}

function checkApprovalSafety(candidate: ReviewPlan, golden: GoldenSpec): CheckResult {
  const text = normalizedText(candidate);
  const recommendsApproval = /\b(approve|approved|ready to merge|ship it|no comments|no findings)\b/.test(text);
  const failures: string[] = [];
  const evidence: string[] = [];

  if (!recommendsApproval) {
    return check("approvalSafety", failures, ["no approve/no-comments recommendation detected"]);
  }

  for (const concern of golden.approvalSafety.requiredConcerns) {
    if (!concern.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
      failures.push(`approval recommendation does not mention ${concern.id}`);
    } else {
      evidence.push(`approval gated by ${concern.id}`);
    }
  }

  return check("approvalSafety", failures, evidence);
}

function checkInlineCommentAnchors(candidate: ReviewPlan): CheckResult {
  const failures: string[] = [];
  const evidence: string[] = [];

  for (const [sliceIndex, slice] of asArray(candidate.slices).entries()) {
    for (const [commentIndex, comment] of asArray(slice.inlineComments).entries()) {
      const id = `${slice.id ?? `slice-${sliceIndex}`}.inlineComments[${commentIndex}]`;
      if (!comment.file) failures.push(`${id} missing file`);
      if (!comment.hunkId) failures.push(`${id} missing hunkId`);
      if (comment.line == null || comment.line === "") failures.push(`${id} missing line`);
      if (!comment.body) failures.push(`${id} missing body`);
      if (comment.file && comment.hunkId && comment.line != null && comment.body) evidence.push(`${id} anchored`);
    }
  }

  return check("inlineCommentAnchors", failures, evidence.length > 0 ? evidence : ["no inline comments to anchor"]);
}

function matchingSlices(candidate: ReviewPlan, theme: GoldenSpec["requiredThemes"][number]) {
  return asArray(candidate.slices).filter((slice) => {
    const files = new Set(asArray(slice.files));
    const text = sliceText(slice);
    const anchorHit = theme.anchorFiles.some((file) => files.has(file) || text.includes(file.toLowerCase()));
    const keywordHits = theme.keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
    return anchorHit && keywordHits >= (theme.minKeywordHits ?? 2);
  });
}

function hasAcceptAndCommentConditions(slice: ReviewPlanSlice) {
  const hasStructured = asArray(slice.acceptConditions).length > 0 && asArray(slice.commentConditions).length > 0;
  if (hasStructured) return true;
  const text = sliceText(slice);
  return /\baccept\b/.test(text) && /\bcomment\b/.test(text);
}

function indexesWithFiles(slices: ReviewPlanSlice[], files: Set<string>) {
  return slices.flatMap((slice, index) => asArray(slice.files).some((file) => files.has(file)) ? [index] : []);
}

function buildOfflineJudgeProxy(candidate: ReviewPlan, golden: GoldenSpec, checks: CheckResult[]): ReviewPlanEvalResult["judge"] {
  const byName = Object.fromEntries(checks.map((item) => [item.name, item]));
  const scores = {
    semanticSlicing: average([byName.requiredThemes.score, byName.sliceSize.score]),
    riskPrioritization: byName.riskRanking.score,
    reviewerUsefulness: average([byName.coverage.score, byName.actionability.score]),
    evidenceQuality: average([byName.evidenceQuality.score, byName.inlineCommentAnchors.score]),
    approvalSafety: byName.approvalSafety.score,
  };
  const missingConcerns = golden.requiredThemes.filter((theme) => matchingSlices(candidate, theme).length === 0).map((theme) => theme.id);
  const unsupportedClaims = byName.approvalSafety.failures;
  const verdict = Object.values(scores).every((score) => score >= 0.8) && missingConcerns.length === 0 && unsupportedClaims.length === 0 ? "pass" : "fail";

  return {
    mode: "offline-contract-proxy",
    scores,
    missingConcerns,
    unsupportedClaims,
    verdict,
    shortRationale: "Offline proxy used because no provider-backed judge JSON was configured.",
  };
}

async function loadConfiguredJudge(): Promise<ReviewPlanEvalResult["judge"] | null> {
  const path = process.env.REVIEW_PLAN_EVAL_JUDGE_JSON;
  if (!path) return null;
  const judge = await loadJson<Omit<ReviewPlanEvalResult["judge"], "mode">>(path);
  return { ...judge, mode: "json-file" };
}

function check(name: string, failures: string[], evidence: string[]): CheckResult {
  return {
    name,
    status: failures.length === 0 ? "pass" : "fail",
    score: failures.length === 0 ? 1 : 0,
    weight: CHECK_WEIGHTS[name] ?? 1,
    failures,
    evidence,
  };
}

function sliceText(slice: ReviewPlanSlice) {
  return normalizedText({
    id: slice.id,
    title: slice.title,
    risk: slice.risk,
    why: slice.why,
    files: slice.files,
    hunks: slice.hunks,
    inlineComments: slice.inlineComments,
    evidence: slice.evidence,
    remainingQuestions: slice.remainingQuestions,
    acceptConditions: slice.acceptConditions,
    commentConditions: slice.commentConditions,
    suggestedDecision: slice.suggestedDecision,
  });
}

function normalizedText(value: unknown) {
  return JSON.stringify(value ?? "").toLowerCase();
}

function isGenericSliceTitle(title: string) {
  return /^(new package|ui behavior|mcp changes|package changes|implementation|misc|miscellaneous|support files)$/i.test(title.trim());
}

function isGenericEvidence(entry: string) {
  const text = entry.trim().toLowerCase();
  const hasConcreteAnchor = /[a-z0-9_-]+\.(ts|tsx|js|jsx|json|md|rs|ya?ml|lock)\b|#h\d+/i.test(text);
  return /(parsed the diff|parsed the local git diff|reviewed the diff|checked the changes|looked at files)/.test(text) && !hasConcreteAnchor;
}

function formatList(values: string[], max = 8) {
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown}, ... (${values.length} total)` : shown;
}

function summarize(verdict: string, deterministicScore: number, judgeScore: number, checks: CheckResult[]) {
  const failed = checks.filter((check) => check.status === "fail");
  if (failed.length === 0) return `${verdict}: deterministic ${deterministicScore}, judge ${judgeScore}`;
  return `${verdict}: ${failed.map((check) => `${check.name}: ${check.failures[0]}`).slice(0, 4).join("; ")}`;
}

function average(values: number[]) {
  return values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
