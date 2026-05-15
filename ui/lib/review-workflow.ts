import { filterActionableQuestions } from "@/lib/review-questions";
import type { ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
import type { Hunk } from "@/lib/review-types";

export type FileHunkGroup = {
  file: string;
  hunks: Hunk[];
  commentCount: number;
};

export type ReviewerBrief = {
  whatChanged: string;
  whyItMatters: string;
  checks: string[];
};

type RepeatedLineChange = {
  removed: string;
  added: string;
};

export function groupComments(comments: ReviewProgressComment[]) {
  const map = new Map<string, ReviewProgressComment[]>();
  for (const comment of comments) {
    const existing = map.get(comment.hunkId) ?? [];
    existing.push(comment);
    map.set(comment.hunkId, existing);
  }
  return map;
}

export function groupHunksByFile(
  hunks: Hunk[],
  commentsByHunk: Map<string, ReviewProgressComment[]>,
): FileHunkGroup[] {
  const groups = new Map<string, FileHunkGroup>();
  for (const hunk of hunks) {
    const group = groups.get(hunk.file) ?? { file: hunk.file, hunks: [], commentCount: 0 };
    group.hunks.push(hunk);
    group.commentCount += commentsByHunk.get(hunk.hunkId)?.length ?? 0;
    groups.set(hunk.file, group);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.commentCount !== b.commentCount) return b.commentCount - a.commentCount;
    return a.file.localeCompare(b.file);
  });
}

export function findNextReviewSlice(
  slices: ReviewProgressSlice[],
  currentId: string,
  reviewedIds: Set<string>,
) {
  const currentIndex = Math.max(0, slices.findIndex((slice) => slice.id === currentId));
  const orderedSlices = [...slices.slice(currentIndex + 1), ...slices.slice(0, currentIndex)];
  const unreviewedSlices = orderedSlices.filter((slice) => !reviewedIds.has(slice.id));

  return (
    unreviewedSlices.find((slice) => countSliceWork({ ...slice, reviewed: false }) > 0) ??
    unreviewedSlices[0]
  );
}

export function countOpenQuestions(slices: ReviewProgressSlice[]) {
  return slices.reduce(
    (total, slice) =>
      total + (slice.reviewed ? 0 : filterActionableQuestions(slice.remainingQuestions).length),
    0,
  );
}

export function buildReviewerBrief(slice: ReviewProgressSlice, actionableQuestions: string[]): ReviewerBrief {
  const lineChange = getRepeatedLineChange(slice);
  const whatChanged = buildChangeSummary(slice, lineChange);
  const whyItMatters = buildReviewFocus(slice, actionableQuestions);

  return {
    whatChanged,
    whyItMatters,
    checks: buildVerificationChecks(slice, actionableQuestions, lineChange),
  };
}

export function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countSliceWork(slice: ReviewProgressSlice) {
  const openComments = slice.comments.filter((comment) => comment.decision === "open").length;
  const openQuestions = slice.reviewed ? 0 : filterActionableQuestions(slice.remainingQuestions).length;
  return openComments + openQuestions;
}

function buildChangeSummary(slice: ReviewProgressSlice, lineChange: RepeatedLineChange | undefined) {
  if (lineChange) {
    return `Repeated edit from ${lineChange.removed} to ${lineChange.added}.`;
  }

  const usefulWhy = usefulBriefSentence(slice.why);
  if (usefulWhy) {
    return usefulWhy;
  }

  const usefulHunkReason = slice.hunks.map((hunk) => usefulBriefSentence(hunk.reason)).find(Boolean);
  if (usefulHunkReason) {
    return usefulHunkReason;
  }

  return slice.title.trim() || "Review the changed behavior in this slice.";
}

function buildReviewFocus(slice: ReviewProgressSlice, actionableQuestions: string[]) {
  const candidates = [
    usefulBriefSentence(slice.decisionQuestion),
    usefulBriefSentence(slice.primaryRisk),
    firstUsefulCondition(slice.commentConditions),
    firstUsefulCondition(slice.acceptConditions),
    actionableQuestions[0],
  ];
  const focusItems: string[] = [];
  for (const candidate of candidates) {
    if (candidate) {
      focusItems.push(candidate);
    }
  }

  if (focusItems.length > 0) {
    return focusItems.slice(0, 2).join(" ");
  }

  return "Decide whether the changed behavior is complete, covered by evidence, and safe to approve.";
}

function firstUsefulCondition(conditions: string[] | undefined) {
  for (const condition of conditions ?? []) {
    const sentence = usefulBriefSentence(condition);
    if (sentence) {
      return sentence;
    }
  }
  return undefined;
}

function usefulBriefSentence(value: string | undefined) {
  const sentence = normalizeSentence(value);
  if (!sentence || isLowSignalBriefText(sentence)) {
    return undefined;
  }

  return sentence;
}

function normalizeSentence(value: string | undefined) {
  const sentence = value?.trim().replace(/\s+/g, " ");
  if (!sentence) return undefined;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function isLowSignalBriefText(value: string) {
  const lower = value.toLowerCase();
  if (/^changes? \d+ hunks? across \d+ files?\./.test(lower)) return true;
  if (lower.includes("#h") && lower.includes(" adds ")) return true;
  if ((lower.match(/\bsrc\//g)?.length ?? 0) >= 2) return true;
  if ((lower.match(/\.(ts|tsx|js|jsx|json|md|example|env)\b/g)?.length ?? 0) >= 2) {
    return true;
  }
  if (lower === "planned by agentic rust review runtime.") return true;
  return false;
}

function buildVerificationChecks(
  slice: ReviewProgressSlice,
  actionableQuestions: string[],
  lineChange: RepeatedLineChange | undefined,
) {
  const checks = new Set<string>();
  const terraformLike = slice.files.some((file) =>
    /(^|\/)(terragrunt|terraform)\b|\.tf$|\.tfvars$|\.ya?ml$/i.test(file),
  );
  const moduleVersionChange = Boolean(
    lineChange && /\b(version|module)\b/i.test(`${lineChange.removed} ${lineChange.added}`),
  );

  if (lineChange) {
    checks.add("Confirm every repeated entry that should receive this change is included, and no unrelated entry moved.");
  }

  if (moduleVersionChange) {
    checks.add("Check the module release notes or changelog for the behavior change and any breaking changes between the old and new versions.");
  }

  if (terraformLike) {
    checks.add("Confirm the Terraform or Terragrunt plan only contains expected infrastructure changes.");
  }

  for (const question of actionableQuestions) {
    checks.add(question);
  }

  if (checks.size === 0) {
    checks.add("Confirm the diff matches the pull request title and stated intent.");
    checks.add("Check nearby configuration or call sites for coupling that would make this change incomplete.");
    checks.add("Confirm tests, plans, or runtime evidence cover the changed behavior.");
  }

  return Array.from(checks).slice(0, 4);
}

function getRepeatedLineChange(slice: ReviewProgressSlice): RepeatedLineChange | undefined {
  const removed = new Set<string>();
  const added = new Set<string>();

  for (const hunk of slice.hunks) {
    const removedLines: string[] = [];
    const addedLines: string[] = [];

    for (const line of hunk.lines) {
      const text = line.text.trim();
      if (!text) {
        continue;
      }

      if (line.kind === "remove") {
        removedLines.push(text);
      } else if (line.kind === "add") {
        addedLines.push(text);
      }
    }

    if (removedLines.length !== 1 || addedLines.length !== 1) {
      return undefined;
    }

    removed.add(removedLines[0]);
    added.add(addedLines[0]);
  }

  if (removed.size !== 1 || added.size !== 1) {
    return undefined;
  }

  return {
    removed: Array.from(removed)[0],
    added: Array.from(added)[0],
  };
}
