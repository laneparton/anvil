import * as React from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Eye,
  FileCode2,
  MessageSquarePlus,
  Terminal,
} from "lucide-react";

import type { ReviewAgent, ReviewSessionEvent } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { applyCommentTonePreset } from "@/lib/comment-tone";
import { filterActionableQuestions } from "@/lib/review-questions";
import type { CommentDecision, ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
import type { Hunk } from "@/lib/review-types";
import { resolveTerminalApp, type AppSettings } from "@/lib/settings";
import { buildReviewerBrief, formatCount } from "@/lib/review-workflow";
import { cn } from "@/lib/utils";

import type { AgentLaunchState } from "../types";

type DecisionStageProps = {
  active: ReviewProgressSlice;
  activeIndex: number;
  activePending: boolean;
  agentLaunchState: AgentLaunchState;
  appSettings: AppSettings;
  currentComment: ReviewProgressComment | undefined;
  handleCommentDecision: (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => void;
  handleOpenAgent: (agent: ReviewAgent) => void;
  markActiveReviewed: () => void;
  openComments: ReviewProgressComment[];
  prepareEvent?: ReviewSessionEvent;
  reviewWorktree?: string;
  selectedCommentId?: string;
  setSelectedCommentId: (commentId: string) => void;
  setCommentDraft: (commentId: string, draft: string) => void;
  totalSlices: number;
};

export function DecisionStage({
  active,
  activeIndex,
  activePending,
  agentLaunchState,
  appSettings,
  currentComment,
  handleCommentDecision,
  handleOpenAgent,
  markActiveReviewed,
  openComments,
  prepareEvent,
  reviewWorktree,
  selectedCommentId,
  setSelectedCommentId,
  setCommentDraft,
  totalSlices,
}: DecisionStageProps) {
  const actionableQuestions = filterActionableQuestions(active.remainingQuestions);
  const currentQuestion = !currentComment && !active.reviewed ? actionableQuestions[0] : undefined;
  const deferredQuestion = active.deferred && !active.reviewed;
  const defaultDraft = currentComment ? applyCommentTonePreset(currentComment.body, appSettings.commentTonePreset) : "";
  const draft = currentComment ? currentComment.draft || defaultDraft : "";
  const canQueueComment = !currentComment || draft.trim().length > 0;
  const evidenceHunks = React.useMemo(() => getEvidenceHunks(active), [active]);
  const primaryHunk = evidenceHunks[0];
  const primaryFile = primaryHunk?.file ?? active.files[0] ?? "unavailable";

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge risk={active.risk} />
              <StatusBadge activePending={activePending} currentComment={currentComment} reviewed={active.reviewed} />
              <span className="text-xs text-muted-foreground">
                {active.files.length} file{active.files.length === 1 ? "" : "s"} · slice {activeIndex + 1} of {totalSlices}
              </span>
            </div>
            <h2 className="mt-2 max-w-4xl text-xl font-semibold leading-tight">
              {currentComment ? currentComment.body : active.decisionQuestion || active.title}
            </h2>
            <p className="mt-1.5 max-w-4xl text-sm leading-6 text-muted-foreground">{active.why}</p>
          </div>
          <AgentButtons
            worktree={reviewWorktree}
            state={agentLaunchState}
            settings={appSettings}
            onOpenAgent={handleOpenAgent}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activePending ? (
            <div className="text-sm text-muted-foreground">
              {prepareEvent?.message ?? "A focused reviewer is inspecting this slice."}
            </div>
          ) : currentComment ? (
            <>
              <Button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={!canQueueComment}
                onClick={() => {
                  if (!currentComment.draft) {
                    setCommentDraft(currentComment.id, defaultDraft);
                  }
                  handleCommentDecision(currentComment, "converted");
                }}
              >
                <MessageSquarePlus className="size-4" />
                Comment on PR
              </Button>
              <Button type="button" className="border-border bg-background" onClick={() => handleCommentDecision(currentComment, "dismissed")}>
                <CheckCircle2 className="size-4" />
                Looks safe
              </Button>
              <Button type="button" className="border-border bg-background" onClick={() => handleCommentDecision(currentComment, "resolved")}>
                <CircleAlert className="size-4" />
                Defer
              </Button>
            </>
          ) : deferredQuestion ? (
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={markActiveReviewed}>
              <CircleAlert className="size-4" />
              Acknowledge deferred
            </Button>
          ) : (
            <>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={markActiveReviewed}>
              <CheckCircle2 className="size-4" />
              Looks safe
            </Button>
            <Button type="button" className="border-border bg-background" onClick={markActiveReviewed}>
              <CircleAlert className="size-4" />
              Defer
            </Button>
            </>
          )}
        </div>
      </section>

      {!currentComment ? <ReviewerBrief slice={active} actionableQuestions={actionableQuestions} /> : null}

      <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Eye className="size-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inspect evidence</h3>
          </div>
          <span className="truncate font-mono text-xs text-muted-foreground">{primaryFile}</span>
        </div>

        {currentComment && openComments.length > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
            <span className="text-xs text-muted-foreground">Select finding</span>
            <div className="flex flex-wrap gap-1">
              {openComments.map((comment, index) => (
                <button
                  key={comment.id}
                  type="button"
                  onClick={() => setSelectedCommentId(comment.id)}
                  className={cn(
                    "grid size-7 place-items-center rounded-md border text-xs",
                    comment.id === selectedCommentId
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          {evidenceHunks.map((hunk) => (
            <EvidenceHunk
              key={hunk.hunkId}
              hunk={hunk}
              currentComment={currentComment}
              draft={draft}
              setCommentDraft={setCommentDraft}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewerBrief({
  slice,
  actionableQuestions,
}: {
  slice: ReviewProgressSlice;
  actionableQuestions: string[];
}) {
  const brief = buildReviewerBrief(slice, actionableQuestions);
  const currentQuestion = !slice.reviewed ? actionableQuestions[0] : undefined;

  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Reviewer brief
        <span className="font-normal normal-case tracking-normal text-muted-foreground">
          {formatCount(slice.hunks.length, "hunk")} across {formatCount(slice.files.length, "file")}
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <BriefRow label="Change to review" value={brief.whatChanged} />
        <BriefRow label="Review focus" value={brief.whyItMatters} />
      </div>
      {currentQuestion ? (
        <div className="grid gap-1 rounded-md border border-anvil-attention/30 bg-anvil-attention/10 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-anvil-attention">Open question</div>
          <p className="break-words text-sm leading-6 text-foreground">{currentQuestion}</p>
        </div>
      ) : null}
      {slice.evidence.length > 0 ? (
        <div className="grid gap-1 rounded-md border bg-background px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</div>
          <ul className="grid gap-1">
            {slice.evidence.slice(0, 4).map((item) => (
              <li key={item} className="break-words text-sm leading-6 text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="break-words text-sm leading-6 text-foreground">{value}</p>
    </div>
  );
}

function EvidenceHunk({
  hunk,
  currentComment,
  draft,
  setCommentDraft,
}: {
  hunk: Hunk;
  currentComment?: ReviewProgressComment;
  draft: string;
  setCommentDraft: (commentId: string, draft: string) => void;
}) {
  const inlineDraftLine = currentComment?.file === hunk.file ? currentComment.line : undefined;
  const hasNewInlineDraftLine = hunk.lines.some(
    (line) => String(line.newNumber) === String(inlineDraftLine) && line.kind !== "remove",
  );

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="size-4 text-primary" />
          <span className="truncate font-mono text-xs">{hunk.file}</span>
        </div>
        <span className="text-xs text-muted-foreground">{hunk.hunkId.split("#").pop()}</span>
      </div>
      {hunk.lines.map((line, index) => (
        <React.Fragment key={`${hunk.hunkId}:${index}`}>
          <div
            className={cn(
              "grid min-w-full grid-cols-[48px_48px_24px_minmax(44rem,1fr)] font-mono text-xs leading-7",
              line.kind === "add" && "bg-anvil-diff-add",
              line.kind === "remove" && "bg-anvil-diff-remove",
            )}
          >
            <span className="select-none pr-2 text-right text-muted-foreground">{line.oldNumber ?? ""}</span>
            <span className="select-none pr-2 text-right text-muted-foreground">{line.newNumber ?? ""}</span>
            <span
              className={cn(
                "select-none text-center",
                line.kind === "add" && "text-anvil-success",
                line.kind === "remove" && "text-destructive",
              )}
            >
              {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
            </span>
            <code className="whitespace-pre text-anvil-code">{line.text || " "}</code>
          </div>
          {currentComment && shouldRenderInlineDraft(line, inlineDraftLine, hasNewInlineDraftLine) ? (
            <InlineDraftComment
              comment={currentComment}
              draft={draft}
              onDraftChange={(nextDraft) => setCommentDraft(currentComment.id, nextDraft)}
            />
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function InlineDraftComment({
  comment,
  draft,
  onDraftChange,
}: {
  comment: ReviewProgressComment;
  draft: string;
  onDraftChange: (draft: string) => void;
}) {
  return (
    <div className="grid min-w-full grid-cols-[48px_48px_24px_minmax(0,1fr)] bg-anvil-diff-add py-2 text-left text-xs leading-5">
      <span />
      <span />
      <span className="relative">
        <span className="absolute left-1/2 top-3 grid size-4 -translate-x-1/2 place-items-center rounded-full bg-anvil-info text-[10px] text-white">
          +
        </span>
      </span>
      <div className="mr-3 rounded-md border bg-card px-3 py-2 shadow-none">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-anvil-info/10 text-[11px] font-semibold text-anvil-info">
              A
            </span>
            <div className="min-w-0 truncate text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Anvil</span>
              <span className="mx-1">·</span>
              <span>Recommended draft</span>
            </div>
          </div>
          <span className="text-xs font-medium text-anvil-info">{comment.severity}</span>
        </div>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="ml-9 min-h-16 w-[calc(100%-2.25rem)] resize-y rounded-md border border-input/70 bg-background/70 px-2.5 py-2 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-input hover:bg-background focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/25"
        />
      </div>
    </div>
  );
}

function shouldRenderInlineDraft(
  line: Hunk["lines"][number],
  targetLine: number | string | undefined,
  hasNewTargetLine: boolean,
) {
  if (targetLine === undefined || targetLine === null) return false;
  if (String(line.newNumber) === String(targetLine) && line.kind !== "remove") return true;
  return !hasNewTargetLine && String(line.oldNumber) === String(targetLine);
}

function getEvidenceHunks(slice: ReviewProgressSlice): Hunk[] {
  if (slice.hunks.length > 0) return slice.hunks;

  // TODO(review-plan): remove this fallback once every prepared slice includes trust-anchor hunks.
  return [
    {
      file: slice.files[0] ?? "review-plan-placeholder.ts",
      hunkId: `${slice.id}#placeholder`,
      reason: slice.why,
      lines: [
        { kind: "context", oldNumber: 1, newNumber: 1, text: "// Review plan did not include a diff hunk for this slice." },
        { kind: "add", oldNumber: null, newNumber: 2, text: "// TODO(review-plan): provide trust-anchor hunk lines from runtime preparation." },
      ],
    },
  ];
}

function RiskBadge({ risk }: { risk: ReviewProgressSlice["risk"] }) {
  return (
    <Badge
      className={cn(
        risk === "high" && "border-destructive/25 bg-destructive/10 text-destructive",
        risk === "medium" && "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
        risk === "low" && "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
      )}
    >
      {risk} risk
    </Badge>
  );
}

function StatusBadge({
  activePending,
  currentComment,
  reviewed,
}: {
  activePending: boolean;
  currentComment?: ReviewProgressComment;
  reviewed: boolean;
}) {
  if (activePending) {
    return <Badge className="border-anvil-info/25 bg-anvil-info/10 text-anvil-info">analyzing</Badge>;
  }

  if (currentComment) {
    return <Badge className="border-anvil-info/25 bg-anvil-info/10 text-anvil-info">needs decision</Badge>;
  }

  return (
    <Badge
      className={
        reviewed
          ? "border-anvil-success/25 bg-anvil-success/10 text-anvil-success"
          : "border-anvil-info/25 bg-anvil-info/10 text-anvil-info"
      }
    >
      {reviewed ? "looks safe" : "ready"}
    </Badge>
  );
}

function AgentButtons({
  worktree,
  state,
  settings,
  onOpenAgent,
}: {
  worktree?: string;
  state: AgentLaunchState;
  settings: AppSettings;
  onOpenAgent: (agent: ReviewAgent) => void;
}) {
  const disabled = !worktree || state.status === "launching";
  const terminalApp = resolveTerminalApp(settings);
  const [open, setOpen] = React.useState(false);
  const preferredAgent = settings.preferredAgent;
  const label = preferredAgent === "claude" ? "Claude" : "Codex";
  const otherAgent = preferredAgent === "claude" ? "codex" : "claude";

  return (
    <div className="grid shrink-0 justify-items-end gap-2">
      <div className="text-xs text-muted-foreground">{worktree ? terminalApp : "Waiting for checkout"}</div>
      <div className="relative shrink-0">
        <div className="inline-flex h-8 overflow-hidden rounded-md border bg-card shadow-sm">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => onOpenAgent(preferredAgent)}
          >
            {state.status === "launching" ? <Terminal className="size-3.5 text-anvil-info" /> : <Bot className="size-3.5 text-anvil-info" />}
            Ask {label}
          </button>
          <button
            type="button"
            className="grid w-8 place-items-center border-l text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-label="Choose agent"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
        {open ? (
          <div className="absolute right-0 top-9 z-10 w-40 rounded-md border bg-card p-1 shadow-lg">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                setOpen(false);
                onOpenAgent(otherAgent);
              }}
            >
              <span>{otherAgent === "claude" ? "Claude" : "Codex"}</span>
              <Terminal className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      {state.status === "error" ? <div className="max-w-56 text-right text-xs text-destructive">{state.error}</div> : null}
    </div>
  );
}
