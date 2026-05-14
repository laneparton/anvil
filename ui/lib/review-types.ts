export type Risk = "high" | "medium" | "low";
export type Status = "blocked" | "needs-human" | "agent-reviewed";

export type DiffLine = {
  kind: "add" | "remove" | "context";
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
};

export type InlineComment = {
  file: string;
  hunkId: string;
  line: number | string;
  severity: "blocking" | "question" | "check" | "nit";
  body: string;
};

export type Hunk = {
  file: string;
  hunkId: string;
  reason: string;
  lines: DiffLine[];
};

export type Slice = {
  id: string;
  title: string;
  risk: Risk;
  status: Status;
  deferred: boolean;
  deferReason: string;
  primaryRisk?: string;
  decisionQuestion?: string;
  whyTheseFilesTogether?: string;
  why: string;
  files: string[];
  filesReviewed: string[];
  hunks: Hunk[];
  inlineComments: InlineComment[];
  remainingQuestions: string[];
  evidence: string[];
  acceptConditions?: string[];
  commentConditions?: string[];
};

export type ReviewPlan = {
  pr: { repo: string; number: number; title: string };
  completion: {
    status: Status;
    reviewedFiles: number;
    totalFiles: number;
    reviewedHunks: number;
    totalHunks: number;
    blockingComments: number;
    openQuestions: number;
  };
  slices: Slice[];
};
