import type { Risk } from "@/lib/review-types";

export type PrototypeSliceStatus = "unresolved" | "queued" | "safe" | "fixed" | "deferred";
export type PrototypeQueueState = "needs-review" | "created-by-me" | "assigned-to-me" | "all-open";
export type PrototypePreparationPhaseId =
  | "reading-pull-request"
  | "finding-review-decisions"
  | "checking-evidence"
  | "building-review-packet";
export type PrototypePreparationStatus = "idle" | "active" | "failed" | "ready";

export type PrototypeEvidenceLine = {
  oldNumber: number | null;
  newNumber: number | null;
  kind: "context" | "add" | "remove";
  text: string;
};

export type PrototypeSlice = {
  id: string;
  title: string;
  risk: Risk;
  status: PrototypeSliceStatus;
  summary: string;
  decision: string;
  suggestedOutcome: string;
  files: string[];
  evidence: Array<{
    file: string;
    line: number;
    note: string;
  }>;
  diff: {
    file: string;
    hunk: string;
    lines: PrototypeEvidenceLine[];
  };
  commentDraft?: string;
  investigation?: {
    question: string;
    result: string;
  };
};

export type PrototypeQueuePullRequest = {
  id: string;
  queueState: PrototypeQueueState;
  provider: "GitHub" | "Bitbucket";
  providerSource: string;
  repo: string;
  number: number;
  author: string;
  age: string;
  title: string;
  reviewReason: string;
  estimatedReviewSize: "Small" | "Medium" | "Large";
  changedFilesCount: number;
  additionsCount: number;
  deletionsCount: number;
  commentsCount: number;
  url: string;
  whyInQueue: string;
  whatAnvilWillDo: string[];
  description: string;
  creator: string;
  requestedReviewers: string[];
  labels: string[];
  checks: {
    passing: number;
    failing: number;
    pending: number;
  };
  approvals: {
    received: number;
    required: number;
  };
  commitsCount: number;
  sourceBranch: string;
  targetBranch: string;
  changedFileGroups: Array<{
    label: string;
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
    }>;
  }>;
  activity: Array<{
    actor: string;
    detail: string;
    age: string;
  }>;
};

export type PrototypePreparationPhase = {
  id: PrototypePreparationPhaseId;
  label: string;
  detail: string;
};

export type PrototypePreparationState = {
  id: string;
  label: string;
  status: PrototypePreparationStatus;
  activePhaseId: PrototypePreparationPhaseId;
  message: string;
  diagnostics: string[];
};

export const prototypePullRequest = {
  title: "skip changed migration",
  repo: "xyleminc/xdl-schema-discovery",
  number: 48,
  source: "Bitbucket",
};

export const prototypeQueueGroups: Array<{
  id: PrototypeQueueState;
  label: string;
  description: string;
}> = [
  {
    id: "needs-review",
    label: "Recommended next",
    description: "PRs where Anvil thinks your review is the next useful action.",
  },
  {
    id: "created-by-me",
    label: "Created by me",
    description: "Your open PRs that may need a final pass.",
  },
  {
    id: "assigned-to-me",
    label: "Assigned to me",
    description: "Explicit review requests and team assignments.",
  },
  {
    id: "all-open",
    label: "Open backlog",
    description: "Other open PRs from connected providers.",
  },
];

export const prototypeQueuePullRequests: PrototypeQueuePullRequest[] = [
  {
    id: "bitbucket:xyleminc/xdl-schema-discovery:48",
    queueState: "needs-review",
    provider: "Bitbucket",
    providerSource: "Bitbucket Cloud",
    repo: prototypePullRequest.repo,
    number: prototypePullRequest.number,
    author: "jbrady",
    age: "2h",
    title: prototypePullRequest.title,
    reviewReason: "You reviewed the previous migration runner change and this PR changes that same path.",
    estimatedReviewSize: "Medium",
    changedFilesCount: 5,
    additionsCount: 47,
    deletionsCount: 12,
    commentsCount: 3,
    url: "https://bitbucket.org/xyleminc/xdl-schema-discovery/pull-requests/48",
    whyInQueue: "A Bitbucket review request is waiting and the diff touches migration behavior that has shipped regressions before.",
    whatAnvilWillDo: [
      "Read the PR metadata and diff.",
      "Find review decisions, not summaries.",
      "Open when the first packet is ready.",
    ],
    description:
      "Replaces the tenant m0002 migration with a skipped migration and updates the test coverage around skip detection. The runtime runner path is the review risk because production classifies skip migrations before running upgrade or verify.",
    creator: "jbrady",
    requestedReviewers: ["Lane Parton", "Data Platform"],
    labels: ["migration", "tenant-runtime"],
    checks: {
      passing: 8,
      failing: 0,
      pending: 1,
    },
    approvals: {
      received: 0,
      required: 1,
    },
    commitsCount: 3,
    sourceBranch: "XTAI-280-AddSkip",
    targetBranch: "main",
    changedFileGroups: [
      {
        label: "Migrations",
        files: [
          { path: "xdl_schema_discovery/migrations/tenant/m0002_skip.py", additions: 18, deletions: 8 },
          { path: "xdl_schema_discovery/migrations/runner.py", additions: 9, deletions: 4 },
        ],
      },
      {
        label: "Tests",
        files: [
          { path: "tests/test_migrations.py", additions: 16, deletions: 0 },
          { path: "tests/fixtures/tenant_migrations.py", additions: 4, deletions: 0 },
        ],
      },
      {
        label: "Docs",
        files: [{ path: "README.md", additions: 0, deletions: 0 }],
      },
    ],
    activity: [
      { actor: "jbrady", detail: "opened this pull request", age: "2h" },
      { actor: "Bitbucket Pipelines", detail: "reported one pending provider check", age: "18m" },
      { actor: "Data Platform", detail: "requested Lane Parton as reviewer", age: "12m" },
    ],
  },
  {
    id: "github:laneparton/anvil-review:126",
    queueState: "needs-review",
    provider: "GitHub",
    providerSource: "GitHub Pull Requests",
    repo: "laneparton/anvil-review",
    number: 126,
    author: "mara",
    age: "4h",
    title: "stream review preparation events",
    reviewReason: "Assigned to you and marked ready after the app-server event contract changed.",
    estimatedReviewSize: "Large",
    changedFilesCount: 12,
    additionsCount: 312,
    deletionsCount: 84,
    commentsCount: 9,
    url: "https://github.com/laneparton/anvil-review/pull/126",
    whyInQueue: "You are the requested reviewer and the PR changes runtime progress behavior.",
    whatAnvilWillDo: [
      "Read the PR metadata and diff.",
      "Check runtime event ordering.",
      "Build a regression-focused packet.",
    ],
    description:
      "Streams preparation progress from the app-server path into the desktop review flow. The main risk is whether event ordering remains stable when planner, critic, and reducer phases overlap.",
    creator: "mara",
    requestedReviewers: ["Lane Parton"],
    labels: ["runtime", "desktop"],
    checks: {
      passing: 12,
      failing: 1,
      pending: 0,
    },
    approvals: {
      received: 0,
      required: 1,
    },
    commitsCount: 7,
    sourceBranch: "stream-preparation-events",
    targetBranch: "main",
    changedFileGroups: [
      {
        label: "UI/App",
        files: [
          { path: "ui/app/review-preparation.ts", additions: 74, deletions: 19 },
          { path: "ui/app/ReviewWorkspaceScreen.tsx", additions: 38, deletions: 8 },
        ],
      },
      {
        label: "Runtime",
        files: [
          { path: "desktop/src/runtime/app_server.rs", additions: 91, deletions: 32 },
          { path: "desktop/src/runtime/session.rs", additions: 34, deletions: 17 },
        ],
      },
      {
        label: "Tests",
        files: [{ path: "ui/app/review-preparation.test.ts", additions: 75, deletions: 8 }],
      },
    ],
    activity: [
      { actor: "mara", detail: "requested your review", age: "4h" },
      { actor: "GitHub Actions", detail: "reported one failing check", age: "22m" },
      { actor: "mara", detail: "pushed 2 commits", age: "16m" },
    ],
  },
  {
    id: "github:laneparton/learning-center:34",
    queueState: "created-by-me",
    provider: "GitHub",
    providerSource: "GitHub Pull Requests",
    repo: "laneparton/learning-center",
    number: 34,
    author: "laneparton",
    age: "1d",
    title: "add adaptive gap log lesson loop",
    reviewReason: "Created by you and waiting for a self-review before merge.",
    estimatedReviewSize: "Small",
    changedFilesCount: 4,
    additionsCount: 89,
    deletionsCount: 16,
    commentsCount: 2,
    url: "https://github.com/laneparton/learning-center/pull/34",
    whyInQueue: "It is your PR, still open, and has not had a final decision pass.",
    whatAnvilWillDo: [
      "Read the lesson and notebook changes.",
      "Check links, anchors, and follow-up tasks.",
      "Prepare a compact self-review packet.",
    ],
    description:
      "Adds the first adaptive gap-log loop to the learning-center repo and colocates lesson material with notebook anchors. This needs a quick self-review for clarity and broken links before merge.",
    creator: "laneparton",
    requestedReviewers: ["Self-review"],
    labels: ["curriculum", "docs"],
    checks: {
      passing: 3,
      failing: 0,
      pending: 0,
    },
    approvals: {
      received: 0,
      required: 0,
    },
    commitsCount: 2,
    sourceBranch: "adaptive-gap-log",
    targetBranch: "main",
    changedFileGroups: [
      {
        label: "Lessons",
        files: [
          { path: "lessons/adaptive-gap-log/lesson.md", additions: 47, deletions: 8 },
          { path: "lessons/adaptive-gap-log/production-anchors.md", additions: 22, deletions: 2 },
        ],
      },
      {
        label: "Notebook",
        files: [{ path: "notebooks/adaptive-gap-log.ipynb", additions: 18, deletions: 6 }],
      },
      {
        label: "Index",
        files: [{ path: "README.md", additions: 2, deletions: 0 }],
      },
    ],
    activity: [
      { actor: "laneparton", detail: "opened this pull request", age: "1d" },
      { actor: "GitHub Actions", detail: "all checks passed", age: "3h" },
    ],
  },
  {
    id: "bitbucket:xyleminc/data-pipelines:91",
    queueState: "assigned-to-me",
    provider: "Bitbucket",
    providerSource: "Bitbucket Cloud",
    repo: "xyleminc/data-pipelines",
    number: 91,
    author: "achen",
    age: "1d",
    title: "tighten catalog retry backoff",
    reviewReason: "Directly assigned to you by the data platform team.",
    estimatedReviewSize: "Medium",
    changedFilesCount: 8,
    additionsCount: 146,
    deletionsCount: 41,
    commentsCount: 5,
    url: "https://bitbucket.org/xyleminc/data-pipelines/pull-requests/91",
    whyInQueue: "The PR is assigned to you and touches retry behavior in a shared job runner.",
    whatAnvilWillDo: [
      "Read the diff and retry tests.",
      "Check timeout, retry, and logging evidence.",
      "Open decisions that need judgment.",
    ],
    description:
      "Tightens retry backoff for catalog sync jobs and changes timeout logging. The important review path is whether slower retry behavior still preserves operator visibility.",
    creator: "achen",
    requestedReviewers: ["Lane Parton", "Data Platform"],
    labels: ["retries", "catalog"],
    checks: {
      passing: 7,
      failing: 0,
      pending: 0,
    },
    approvals: {
      received: 1,
      required: 1,
    },
    commitsCount: 5,
    sourceBranch: "catalog-retry-backoff",
    targetBranch: "develop",
    changedFileGroups: [
      {
        label: "Jobs",
        files: [
          { path: "pipelines/catalog/retry_policy.py", additions: 42, deletions: 15 },
          { path: "pipelines/catalog/sync_job.py", additions: 31, deletions: 7 },
        ],
      },
      {
        label: "Config",
        files: [{ path: "config/catalog_backoff.yml", additions: 12, deletions: 5 }],
      },
      {
        label: "Tests",
        files: [
          { path: "tests/catalog/test_retry_policy.py", additions: 44, deletions: 10 },
          { path: "tests/catalog/test_sync_job.py", additions: 17, deletions: 4 },
        ],
      },
    ],
    activity: [
      { actor: "achen", detail: "assigned Data Platform reviewers", age: "1d" },
      { actor: "Bitbucket Pipelines", detail: "all provider checks passed", age: "6h" },
      { actor: "Lane Parton", detail: "approved the previous revision", age: "3h" },
    ],
  },
  {
    id: "github:xyleminc/infra-modules:211",
    queueState: "all-open",
    provider: "GitHub",
    providerSource: "GitHub Pull Requests",
    repo: "xyleminc/infra-modules",
    number: 211,
    author: "slopez",
    age: "3d",
    title: "rotate staging oauth client",
    reviewReason: "Open in a watched repository with a small configuration diff.",
    estimatedReviewSize: "Small",
    changedFilesCount: 2,
    additionsCount: 21,
    deletionsCount: 18,
    commentsCount: 1,
    url: "https://github.com/xyleminc/infra-modules/pull/211",
    whyInQueue: "The repository is watched, but no direct review request was found.",
    whatAnvilWillDo: [
      "Read the config diff.",
      "Check environment drift and rollout notes.",
      "Build a packet if there is a decision.",
    ],
    description:
      "Rotates the staging OAuth client references in shared infrastructure modules. This is likely small, but it needs a check that all staging consumers moved together.",
    creator: "slopez",
    requestedReviewers: ["Infra"],
    labels: ["staging", "oauth"],
    checks: {
      passing: 5,
      failing: 0,
      pending: 0,
    },
    approvals: {
      received: 0,
      required: 1,
    },
    commitsCount: 1,
    sourceBranch: "rotate-staging-oauth-client",
    targetBranch: "main",
    changedFileGroups: [
      {
        label: "Terraform",
        files: [
          { path: "modules/oauth/staging.tf", additions: 12, deletions: 11 },
          { path: "modules/oauth/variables.tf", additions: 9, deletions: 7 },
        ],
      },
    ],
    activity: [
      { actor: "slopez", detail: "opened this pull request", age: "3d" },
      { actor: "GitHub Actions", detail: "all checks passed", age: "2d" },
    ],
  },
];

export const prototypePreparationPhases: PrototypePreparationPhase[] = [
  {
    id: "reading-pull-request",
    label: "Reading pull request",
    detail: "Loading the provider metadata, title, author, changed files, and latest diff.",
  },
  {
    id: "finding-review-decisions",
    label: "Finding review decisions",
    detail: "Separating review-worthy questions from mechanical changes and summary noise.",
  },
  {
    id: "checking-evidence",
    label: "Checking evidence",
    detail: "Matching each decision to files, hunks, tests, and source lines.",
  },
  {
    id: "building-review-packet",
    label: "Building review packet",
    detail: "Preparing the decision workflow and queued draft comments.",
  },
];

export const prototypePreparationStates: PrototypePreparationState[] = [
  {
    id: "start",
    label: "Start",
    status: "idle",
    activePhaseId: "reading-pull-request",
    message: "Waiting to start the review packet.",
    diagnostics: ["No provider calls have started.", "Selected fixture PR is ready."],
  },
  {
    id: "reading",
    label: "Reading",
    status: "active",
    activePhaseId: "reading-pull-request",
    message: "Reading Bitbucket metadata and changed files.",
    diagnostics: ["bitbucket.pr.loaded", "diff.files.discovered: 5"],
  },
  {
    id: "decisions",
    label: "Decisions",
    status: "active",
    activePhaseId: "finding-review-decisions",
    message: "Finding the decisions that should open first.",
    diagnostics: ["planner.candidates: 9", "planner.accepted: 4"],
  },
  {
    id: "evidence",
    label: "Evidence",
    status: "active",
    activePhaseId: "checking-evidence",
    message: "Checking evidence for the migration runner path.",
    diagnostics: ["evidence.tests/test_migrations.py:34", "evidence.runner.py:668"],
  },
  {
    id: "packet",
    label: "Packet",
    status: "active",
    activePhaseId: "building-review-packet",
    message: "Building the first review packet.",
    diagnostics: ["packet.slices.ready: 2", "packet.inline_drafts.ready: 1"],
  },
  {
    id: "failed",
    label: "Failed",
    status: "failed",
    activePhaseId: "checking-evidence",
    message: "Evidence check failed while reading the provider diff.",
    diagnostics: ["provider.diff.fetch.failed", "Bitbucket returned a temporary 502 for pull request 48."],
  },
  {
    id: "ready",
    label: "Ready",
    status: "ready",
    activePhaseId: "building-review-packet",
    message: "The first decisions are ready.",
    diagnostics: ["packet.ready", "opening decision-flow"],
  },
];

export const prototypeSlices: PrototypeSlice[] = [
  {
    id: "migration-runtime-path",
    title: "Migration runtime path changed",
    risk: "high",
    status: "unresolved",
    summary: "The tests now call the skip migration directly, but production reaches tenant migrations through the runner.",
    decision: "Does the new test still cover the production path?",
    suggestedOutcome: "Comment unless the runtime runner path is covered somewhere else.",
    files: ["tests/test_migrations.py", "xdl_schema_discovery/migrations/runner.py"],
    evidence: [
      {
        file: "tests/test_migrations.py",
        line: 34,
        note: "The test imports the skip migration module directly.",
      },
      {
        file: "xdl_schema_discovery/migrations/runner.py",
        line: 668,
        note: "The runner classifies skip migrations before upgrade or verify.",
      },
    ],
    diff: {
      file: "tests/test_migrations.py",
      hunk: "h1",
      lines: [
        { oldNumber: 31, newNumber: 31, kind: "context", text: "    get_migration_status," },
        { oldNumber: 32, newNumber: 32, kind: "context", text: "    get_migration_summary," },
        { oldNumber: 33, newNumber: 33, kind: "context", text: ")" },
        {
          oldNumber: 34,
          newNumber: null,
          kind: "remove",
          text: "from xdl_schema_discovery.migrations.tenant.m0002_drop_preview_freq_from_catalog import upgrade as upgrade_tenant_m0002",
        },
        {
          oldNumber: null,
          newNumber: 34,
          kind: "add",
          text: "from xdl_schema_discovery.migrations.tenant.m0002_skip import upgrade as upgrade_tenant_m0002",
        },
      ],
    },
    commentDraft:
      "Could we cover the real runner path before landing? This switches the m0002 test to call the skip migration directly, but production classifies skip migrations before calling upgrade or verify.",
    investigation: {
      question: "Check whether production calls m0002_skip.upgrade directly.",
      result:
        "No direct production path found. The runner detects skip migrations by basename and records success before upgrade or verify is called.",
    },
  },
  {
    id: "readme-contract",
    title: "README says the skipped migration still verifies",
    risk: "medium",
    status: "unresolved",
    summary: "The documentation still implies skip migrations run verification even though the runner path now treats them as metadata-only.",
    decision: "Should the README contract change with the runtime behavior?",
    suggestedOutcome: "Ask for a doc update or mark safe if the README is intentionally describing manual execution.",
    files: ["README.md"],
    evidence: [
      {
        file: "README.md",
        line: 72,
        note: "The text describes verify behavior that no longer matches the runner path.",
      },
    ],
    diff: {
      file: "README.md",
      hunk: "h2",
      lines: [
        { oldNumber: 70, newNumber: 70, kind: "context", text: "### Tenant migrations" },
        {
          oldNumber: 71,
          newNumber: 71,
          kind: "context",
          text: "Skipped migrations are retained for audit history.",
        },
        {
          oldNumber: 72,
          newNumber: 72,
          kind: "context",
          text: "Each skipped migration still runs upgrade and verify during tenant startup.",
        },
      ],
    },
    commentDraft:
      "If skip migrations are now metadata-only in the runner, this README line should be updated so reviewers do not expect upgrade or verify to run.",
  },
  {
    id: "case-normalization",
    title: "Skip migration names become case-insensitive",
    risk: "low",
    status: "unresolved",
    summary: "The helper now accepts mixed-case and uppercase skip suffixes.",
    decision: "Is accepting mixed-case skip names intentional and covered?",
    suggestedOutcome: "Looks safe if this is intended compatibility behavior.",
    files: ["tests/test_migrations.py"],
    evidence: [
      {
        file: "tests/test_migrations.py",
        line: 671,
        note: "New assertions cover mixed-case and uppercase skip suffixes.",
      },
    ],
    diff: {
      file: "tests/test_migrations.py",
      hunk: "h3",
      lines: [
        {
          oldNumber: 670,
          newNumber: 670,
          kind: "context",
          text: 'assert _is_skip_migration("m0001_skip") is True',
        },
        {
          oldNumber: null,
          newNumber: 671,
          kind: "add",
          text: 'assert _is_skip_migration("m0001_Skip") is True',
        },
        {
          oldNumber: null,
          newNumber: 672,
          kind: "add",
          text: 'assert _is_skip_migration("m0001_SKIP") is True',
        },
        {
          oldNumber: 671,
          newNumber: 673,
          kind: "context",
          text: 'assert _is_skip_migration("m0001_create_views") is False',
        },
      ],
    },
  },
  {
    id: "mechanical-cleanup",
    title: "Mechanical import cleanup",
    risk: "low",
    status: "deferred",
    summary: "A low-value import ordering change can wait until higher-risk behavior is resolved.",
    decision: "No immediate review decision needed.",
    suggestedOutcome: "Defer until the runtime-path question is answered.",
    files: ["tests/test_migrations.py"],
    evidence: [
      {
        file: "tests/test_migrations.py",
        line: 36,
        note: "Import ordering only.",
      },
    ],
    diff: {
      file: "tests/test_migrations.py",
      hunk: "h4",
      lines: [
        {
          oldNumber: 36,
          newNumber: 36,
          kind: "context",
          text: "from xdl_schema_discovery.sql import constants as sc",
        },
      ],
    },
  },
];
