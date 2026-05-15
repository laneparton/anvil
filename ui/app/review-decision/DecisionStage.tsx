import { CheckCircle2, CircleAlert, MessageSquarePlus, Send, Terminal, XCircle } from "lucide-react";

import type { ReviewAgent, ReviewSessionEvent } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { applyCommentTonePreset } from "@/lib/comment-tone";
import { filterActionableQuestions } from "@/lib/review-questions";
import type { CommentDecision, ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
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

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge risk={active.risk} />
              {activePending ? (
                <Badge className="border-anvil-info/25 bg-anvil-info/10 text-anvil-info">analyzing</Badge>
              ) : (
                <Badge className="border-anvil-info/25 bg-anvil-info/10 text-anvil-info">
                  {currentComment ? "needs decision" : active.reviewed ? "reviewed" : "ready"}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                Slice {activeIndex + 1} of {totalSlices}
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
              <Button type="button" className="border-border bg-background" onClick={() => handleCommentDecision(currentComment, "resolved")}>
                <CheckCircle2 className="size-4" />
                Fixed locally
              </Button>
              <Button type="button" className="border-border bg-background" onClick={() => handleCommentDecision(currentComment, "dismissed")}>
                <XCircle className="size-4" />
                Dismiss
              </Button>
            </>
          ) : deferredQuestion ? (
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={markActiveReviewed}>
              <CircleAlert className="size-4" />
              Acknowledge deferred
            </Button>
          ) : (
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={markActiveReviewed}>
              <CheckCircle2 className="size-4" />
              Looks safe
            </Button>
          )}
        </div>
      </section>

      {currentComment ? (
        <section className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Badge
                className={cn(
                  currentComment.severity === "blocking"
                    ? "border-destructive/25 bg-destructive/10 text-destructive"
                    : "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
                )}
              >
                {currentComment.severity}
              </Badge>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {currentComment.file}:{currentComment.line}
              </span>
            </div>
            {openComments.length > 1 ? (
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
            ) : null}
          </div>
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PR comment draft</span>
            <textarea
              value={draft}
              onChange={(event) => setCommentDraft(currentComment.id, event.target.value)}
              className="min-h-28 resize-y rounded-md border bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </section>
      ) : (
        <ReviewerBrief slice={active} actionableQuestions={actionableQuestions} />
      )}
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
  const agents = settings.preferredAgent === "claude" ? (["claude", "codex"] as const) : (["codex", "claude"] as const);

  return (
    <div className="grid shrink-0 justify-items-end gap-2">
      <div className="text-xs text-muted-foreground">{worktree ? terminalApp : "Waiting for checkout"}</div>
      <div className="flex items-center gap-1.5">
        {agents.map((agent) => (
          <Button
            key={agent}
            type="button"
            className={cn(
              "h-8 border-border px-2 text-xs hover:bg-accent",
              agent === settings.preferredAgent
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-background",
            )}
            disabled={disabled}
            onClick={() => onOpenAgent(agent)}
          >
            <Terminal className="size-3.5" />
            {agent === "claude" ? "Claude" : "Codex"}
          </Button>
        ))}
      </div>
    </div>
  );
}
