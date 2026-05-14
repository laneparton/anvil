import * as React from "react";
import { CheckCircle2, FileCode2, Loader2, MessageSquare, ShieldAlert } from "lucide-react";

import type { ReviewSessionEvent } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { filterActionableQuestions } from "@/lib/review-questions";
import type { ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
import { highlightTypeScriptLines, type HighlightToken } from "@/lib/syntax-highlight";
import type { Hunk } from "@/lib/review-types";
import { cn } from "@/lib/utils";
import {
  buildReviewerBrief,
  formatCount,
  groupHunksByFile,
  type FileHunkGroup,
} from "@/lib/review-workflow";

export function SliceReviewPanel({
  active,
  activeIndex,
  activePending,
  commentsByHunk,
  currentComment,
  openComments,
  prepareEvent,
  selectedCommentId,
  setSelectedCommentId,
  totalSlices,
}: {
  active: ReviewProgressSlice;
  activeIndex: number;
  activePending: boolean;
  commentsByHunk: Map<string, ReviewProgressComment[]>;
  currentComment: ReviewProgressComment | undefined;
  openComments: ReviewProgressComment[];
  prepareEvent?: ReviewSessionEvent;
  selectedCommentId: string | undefined;
  setSelectedCommentId: (commentId: string) => void;
  totalSlices: number;
}) {
  return (
    <>
      <div className="sticky top-0 z-10 -mx-5 mb-4 flex items-start justify-between gap-4 border-b bg-background/95 px-5 pb-4 backdrop-blur">
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted-foreground">
            Slice {activeIndex + 1} of {totalSlices}
          </div>
          <h2 className="max-w-3xl text-2xl font-semibold leading-tight">{active.title}</h2>
        </div>
      </div>

      <div className="grid gap-4">
        {activePending ? (
          <PendingSlicePanel slice={active} event={prepareEvent} />
        ) : active.deferred ? (
          <DeferredSlicePanel slice={active} />
        ) : (
          <>
            {!currentComment ? <SliceReviewContext slice={active} /> : null}
            {groupHunksByFile(active.hunks, commentsByHunk).map((fileGroup, fileIndex) => (
              <FileDiffGroup
                key={`${active.id}:${fileGroup.file}`}
                group={fileGroup}
                defaultOpen={fileGroup.commentCount > 0 || (openComments.length === 0 && fileIndex === 0)}
                commentsByHunk={commentsByHunk}
                selectedCommentId={selectedCommentId}
                onSelectComment={setSelectedCommentId}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function PendingSlicePanel({ slice, event }: { slice: ReviewProgressSlice; event?: ReviewSessionEvent }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="size-4 animate-spin" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Analyzing this slice</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {event?.message ?? "The agent is reviewing the code for this slice."}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {slice.files.map((file) => (
          <div key={file} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            <span className="truncate font-mono text-xs">{file}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeferredSlicePanel({ slice }: { slice: ReviewProgressSlice }) {
  return (
    <div className="rounded-lg border border-anvil-attention/30 bg-anvil-attention/10 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-anvil-attention/15 text-anvil-attention">
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Deferred for later review</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {slice.deferReason || "Low-value slice deferred while higher-risk code is reviewed first."}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {slice.files.map((file) => (
          <div key={file} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            <span className="truncate font-mono text-xs">{file}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileDiffGroup({
  group,
  defaultOpen,
  commentsByHunk,
  selectedCommentId,
  onSelectComment,
}: {
  group: FileHunkGroup;
  defaultOpen: boolean;
  commentsByHunk: Map<string, ReviewProgressComment[]>;
  selectedCommentId: string | undefined;
  onSelectComment: (commentId: string) => void;
}) {
  const hasComments = group.commentCount > 0;

  return (
    <details className="group rounded-lg border bg-card text-card-foreground" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className={cn("size-4 shrink-0", hasComments ? "text-primary" : "text-muted-foreground")} />
          <span className="truncate font-mono text-xs">{group.file}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasComments ? (
            <Badge className="border-destructive/25 bg-destructive/10 text-destructive">
              {group.commentCount} {group.commentCount === 1 ? "comment" : "comments"}
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {group.hunks.length} {group.hunks.length === 1 ? "hunk" : "hunks"}
          </span>
          <span className="text-xs text-muted-foreground group-open:hidden">expand</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">collapse</span>
        </div>
      </summary>
      <div className="border-t">
        {group.hunks.map((hunk) => (
          <HunkView
            key={hunk.hunkId}
            hunk={hunk}
            comments={commentsByHunk.get(hunk.hunkId) ?? []}
            selectedCommentId={selectedCommentId}
            onSelectComment={onSelectComment}
          />
        ))}
      </div>
    </details>
  );
}

function HunkView({
  hunk,
  comments,
  selectedCommentId,
  onSelectComment,
}: {
  hunk: Hunk;
  comments: ReviewProgressComment[];
  selectedCommentId: string | undefined;
  onSelectComment: (commentId: string) => void;
}) {
  const commentsByLine = new Map(comments.map((comment) => [String(comment.line), comment]));
  const sourceLines = React.useMemo(() => hunk.lines.map((line) => line.text || " "), [hunk.lines]);
  const highlightedLines = useHighlightedLines(sourceLines);

  return (
    <div className="overflow-hidden border-b last:border-b-0">
      <div className="flex items-center justify-between bg-muted/25 px-3 py-1.5">
        <code className="text-xs text-muted-foreground">{hunk.hunkId.split("#").pop()}</code>
      </div>
      <div className="overflow-x-auto bg-card">
        {hunk.lines.map((line, index) => {
          const comment =
            commentsByLine.get(String(line.newNumber)) ??
            commentsByLine.get(String(line.oldNumber)) ??
            commentsByLine.get(line.text);
          return (
            <React.Fragment key={`${hunk.hunkId}-${index}`}>
              <div
                className={cn(
                  "grid min-w-full grid-cols-[48px_48px_24px_minmax(0,1fr)] font-mono text-xs leading-6",
                  line.kind === "add" && "bg-primary/10",
                  line.kind === "remove" && "bg-destructive/10",
                )}
              >
                <span className="select-none pr-2 text-right text-muted-foreground">{line.oldNumber ?? ""}</span>
                <span className="select-none pr-2 text-right text-muted-foreground">{line.newNumber ?? ""}</span>
                <span
                  className={cn(
                    "select-none text-center",
                    line.kind === "add" && "text-primary",
                    line.kind === "remove" && "text-destructive",
                  )}
                >
                  {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                </span>
                <code className="whitespace-pre text-anvil-code">
                  <HighlightedCode text={line.text || " "} tokens={highlightedLines[index]} />
                </code>
              </div>
              {comment ? (
                <InlineNote
                  comment={comment}
                  selected={comment.id === selectedCommentId}
                  onSelect={() => onSelectComment(comment.id)}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function InlineNote({ comment, selected, onSelect }: { comment: ReviewProgressComment; selected: boolean; onSelect: () => void }) {
  const blocking = comment.severity === "blocking";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid min-w-full grid-cols-[48px_48px_24px_minmax(0,1fr)] py-1 text-left text-xs leading-5",
        blocking ? "bg-destructive/5" : "bg-anvil-attention/5",
      )}
    >
      <span />
      <span />
      <span />
      <span
        className={cn(
          "mr-3 rounded-md border border-l-4 p-2",
          blocking
            ? "border-destructive/25 border-l-destructive bg-destructive/10 text-destructive"
            : "border-anvil-attention/30 border-l-anvil-attention bg-anvil-attention/10 text-anvil-attention",
          selected && "ring-2 ring-primary/35",
        )}
      >
        <span className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase">
          {blocking ? <ShieldAlert className="size-4" /> : <MessageSquare className="size-4" />}
          <span>{comment.severity}</span>
        </span>
        <span className="block whitespace-normal break-words leading-5">{comment.body}</span>
      </span>
    </button>
  );
}

function SliceReviewContext({ slice }: { slice: ReviewProgressSlice }) {
  const actionableQuestions = filterActionableQuestions(slice.remainingQuestions);
  const brief = buildReviewerBrief(slice, actionableQuestions);
  const currentQuestion = !slice.reviewed ? actionableQuestions[0] : undefined;

  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <FileCode2 className="size-4" />
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
      <VerificationChecklist checks={brief.checks} />
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

function VerificationChecklist({ checks }: { checks: string[] }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <CheckCircle2 className="size-4" />
        Verify before approval
      </div>
      <ul className="grid gap-2">
        {checks.map((check) => (
          <li key={check} className="flex gap-2 text-sm leading-6 text-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span className="break-words">{check}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useHighlightedLines(lines: string[]) {
  const [tokens, setTokens] = React.useState<HighlightToken[][]>([]);
  const code = React.useMemo(() => lines.join("\n"), [lines]);

  React.useEffect(() => {
    let cancelled = false;

    highlightTypeScriptLines(lines)
      .then((nextTokens) => {
        if (!cancelled) {
          setTokens(nextTokens);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokens([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, lines]);

  return tokens;
}

function HighlightedCode({ text, tokens }: { text: string; tokens: HighlightToken[] | undefined }) {
  if (!tokens?.length) {
    return <>{text}</>;
  }

  return (
    <>
      {tokens.map((token, index) => (
        <span
          key={`${index}:${token.content}`}
          style={{
            color: token.color,
            fontStyle: token.fontStyle === 1 ? "italic" : undefined,
            fontWeight: token.fontStyle === 2 ? 600 : undefined,
          }}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}
