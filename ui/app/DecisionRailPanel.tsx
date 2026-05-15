import { CheckCircle2, Loader2, Send, Terminal, XCircle } from "lucide-react";

import type { ReviewAgent, ReviewSessionEvent } from "@/lib/api";
import { QueuedCommentTray } from "@/components/review/queued-comment-tray";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { applyCommentTonePreset } from "@/lib/comment-tone";
import { filterActionableQuestions } from "@/lib/review-questions";
import type { CommentDecision, ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
import { resolveTerminalApp, type AppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

import type { AgentLaunchState } from "./types";

export function DecisionRailPanel({
  active,
  activePending,
  agentLaunchState,
  appSettings,
  currentComment,
  handleCommentDecision,
  handleOpenAgent,
  markActiveReviewed,
  openComments,
  prepareEvent,
  queuedComments,
  reviewComplete,
  reviewWorktree,
  selectedCommentId,
  setActiveId,
  setSelectedCommentId,
  setCommentDraft,
  setCommentDecision,
  resetCommentDecision,
  setSliceReviewed,
}: {
  active: ReviewProgressSlice;
  activePending: boolean;
  agentLaunchState: AgentLaunchState;
  appSettings: AppSettings;
  currentComment: ReviewProgressComment | undefined;
  handleCommentDecision: (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => void;
  handleOpenAgent: (agent: ReviewAgent) => void;
  markActiveReviewed: () => void;
  openComments: ReviewProgressComment[];
  prepareEvent?: ReviewSessionEvent;
  queuedComments: ReviewProgressComment[];
  reviewComplete: boolean;
  reviewWorktree?: string;
  selectedCommentId: string | undefined;
  setActiveId: (activeId: string) => void;
  setSelectedCommentId: (commentId: string) => void;
  setCommentDraft: (commentId: string, draft: string) => void;
  setCommentDecision: (commentId: string, decision: CommentDecision) => void;
  resetCommentDecision: (commentId: string) => void;
  setSliceReviewed: (sliceId: string, reviewed: boolean) => void;
}) {
  return (
    <aside className="grid min-w-0 gap-3 p-3">
      {!reviewComplete && !activePending ? (
        <DecisionRail
          slice={active}
          comment={currentComment}
          openComments={openComments}
          selectedCommentId={selectedCommentId}
          tonePreset={appSettings.commentTonePreset}
          onSelectComment={setSelectedCommentId}
          onMarkReviewed={markActiveReviewed}
          onSetCommentDraft={setCommentDraft}
          onSetCommentDecision={handleCommentDecision}
        />
      ) : activePending ? (
        <PendingDecisionRail event={prepareEvent} />
      ) : null}

      <QueuedCommentTray
        comments={queuedComments}
        onEdit={(comment) => {
          setActiveId(comment.sliceId);
          setSelectedCommentId(comment.id);
          setSliceReviewed(comment.sliceId, false);
          setCommentDecision(comment.id, "open");
        }}
        onRemove={(comment) => {
          resetCommentDecision(comment.id);
          setSliceReviewed(comment.sliceId, false);
          setActiveId(comment.sliceId);
          setSelectedCommentId(comment.id);
        }}
      />

      <AgentHandoffPanel
        worktree={reviewWorktree}
        state={agentLaunchState}
        settings={appSettings}
        onOpenAgent={handleOpenAgent}
      />
    </aside>
  );
}

function PendingDecisionRail({ event }: { event?: ReviewSessionEvent }) {
  return (
    <Card className="min-w-0 max-w-full overflow-hidden">
      <CardHeader className="px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current status</div>
      </CardHeader>
      <CardContent className="grid gap-3 p-3">
        <div className="flex items-center gap-3 rounded-md border bg-background px-3 py-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-sm">Reviewing slice</span>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {event?.message ??
            "A focused reviewer is inspecting this slice. Decisions appear here when findings are ready."}
        </p>
      </CardContent>
    </Card>
  );
}

function DecisionRail({
  slice,
  comment,
  openComments,
  selectedCommentId,
  tonePreset,
  onSelectComment,
  onMarkReviewed,
  onSetCommentDraft,
  onSetCommentDecision,
}: {
  slice: ReviewProgressSlice;
  comment: ReviewProgressComment | undefined;
  openComments: ReviewProgressComment[];
  selectedCommentId: string | undefined;
  tonePreset: AppSettings["commentTonePreset"];
  onSelectComment: (commentId: string) => void;
  onMarkReviewed: () => void;
  onSetCommentDraft: (commentId: string, draft: string) => void;
  onSetCommentDecision: (comment: ReviewProgressComment, decision: Exclude<CommentDecision, "open">) => void;
}) {
  const actionableQuestions = filterActionableQuestions(slice.remainingQuestions);
  const currentQuestion = !comment && !slice.reviewed ? actionableQuestions[0] : undefined;
  const deferredQuestion = slice.deferred && !slice.reviewed;
  const isClean = !comment && !currentQuestion;
  const defaultDraft = comment ? applyCommentTonePreset(comment.body, tonePreset) : "";
  const draft = comment ? comment.draft || defaultDraft : "";

  return (
    <Card className="min-w-0 max-w-full overflow-hidden">
      <CardHeader className="px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {comment ? "Action finding" : deferredQuestion ? "Acknowledge deferred" : "Review decision"}
        </div>
      </CardHeader>
      <CardContent className="grid w-full min-w-0 max-w-full gap-4 p-3">
        {comment ? (
          <>
            {openComments.length > 1 ? (
              <div className="grid gap-1">
                {openComments.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => onSelectComment(candidate.id)}
                    className={cn(
                      "grid grid-cols-[1.25rem_1fr] items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs",
                      candidate.id === selectedCommentId
                        ? "border-primary/40 bg-primary/5"
                        : "border-transparent hover:bg-accent",
                    )}
                  >
                    <span className="grid size-5 place-items-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate font-mono text-muted-foreground">
                      {candidate.file}:{candidate.line}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Badge
                  className={cn(
                    comment.severity === "blocking"
                      ? "border-destructive/25 bg-destructive/10 text-destructive"
                      : "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
                  )}
                >
                  {comment.severity}
                </Badge>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {comment.file}:{comment.line}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  PR comment draft
                </span>
                <textarea
                  rows={8}
                  value={draft}
                  onChange={(event) => onSetCommentDraft(comment.id, event.target.value)}
                  className="min-h-44 resize-y rounded-md border bg-background p-2 text-sm leading-5 outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <Button
                type="button"
                className="w-full min-w-0 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => {
                  if (!comment.draft) {
                    onSetCommentDraft(comment.id, defaultDraft);
                  }
                  onSetCommentDecision(comment, "converted");
                }}
              >
                <Send className="size-4" />
                Queue PR comment
              </Button>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="w-full min-w-0 border-input bg-card"
                  onClick={() => onSetCommentDecision(comment, "dismissed")}
                >
                  <XCircle className="size-4" />
                  Dismiss
                </Button>
                <Button
                  type="button"
                  className="w-full min-w-0 border-input bg-card"
                  onClick={() => onSetCommentDecision(comment, "resolved")}
                >
                  <CheckCircle2 className="size-4" />
                  Fixed
                </Button>
              </div>
            </div>
          </>
        ) : deferredQuestion ? (
          <>
            <div className="grid gap-2">
              <Badge className="w-fit border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention">
                deferred
              </Badge>
              <p className="break-words text-sm leading-6">
                {slice.deferReason || currentQuestion || "Review this low-value slice later."}
              </p>
            </div>
            <Button
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onMarkReviewed}
            >
              Acknowledge & next
            </Button>
          </>
        ) : currentQuestion ? (
          <>
            <div className="grid gap-2 rounded-md border border-anvil-attention/30 bg-anvil-attention/10 p-3">
              <Badge className="w-fit border-anvil-attention/30 bg-background text-anvil-attention">question</Badge>
              <p className="break-words text-sm leading-6 text-foreground">
                Resolve the open question in the brief before finishing this slice.
              </p>
            </div>
            <Button
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onMarkReviewed}
            >
              Mark checked & next
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-2 rounded-md border border-primary/25 bg-primary/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">Suggested outcome</span>
                <Badge className="border-primary/25 bg-background text-primary">No inline comments</Badge>
              </div>
              <p className="text-sm leading-6 text-foreground">
                {isClean
                  ? "Approve or finish this slice with no comments once the brief checks pass."
                  : "No open findings in this slice."}
              </p>
            </div>
            <Button
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onMarkReviewed}
            >
              Finish slice: no comments
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AgentHandoffPanel({
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
  const statusText =
    state.status === "launching"
      ? `Opening ${labelAgent(state.agent)}...`
      : state.status === "launched"
        ? `${labelAgent(state.agent)} opened in ${terminalApp}.`
        : state.status === "error"
          ? state.error
          : worktree
            ? `${terminalApp} · ${labelAgent(settings.preferredAgent)} preferred`
            : "Waiting for checkout...";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Open with</div>
          <h3 className="truncate text-sm font-semibold">Agent terminal</h3>
        </div>
        <Terminal className="size-4 shrink-0 text-muted-foreground" />
      </CardHeader>
      <CardContent className="grid gap-2 p-3">
        <p className={cn("truncate text-xs text-muted-foreground", state.status === "error" && "text-destructive")}>
          {statusText}
        </p>
        <div className="grid grid-cols-2 gap-2">
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
              {state.status === "launching" && state.agent === agent ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Terminal className="size-3.5" />
              )}
              {labelAgent(agent)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function labelAgent(agent?: ReviewAgent) {
  return agent === "claude" ? "Claude" : "Codex";
}
