import { CheckCircle2, ChevronDown, CircleAlert, Loader2, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
import { cn } from "@/lib/utils";

type LedgerRow = {
  id: string;
  sliceId: string;
  title: string;
  detail: string;
  status: "done" | "active" | "idle" | "deferred";
  openCount: number;
  quiet: boolean;
};

type DecisionLedgerPanelProps = {
  activeId: string;
  deferredSlices: ReviewProgressSlice[];
  pendingSliceCount: number;
  reviewComplete: boolean;
  slices: ReviewProgressSlice[];
  queuedComments: ReviewProgressComment[];
  summaryActive: boolean;
  onSelect: (sliceId: string) => void;
  onSelectSummary: () => void;
};

export function DecisionLedgerPanel({
  activeId,
  deferredSlices,
  pendingSliceCount,
  reviewComplete,
  slices,
  queuedComments,
  summaryActive,
  onSelect,
  onSelectSummary,
}: DecisionLedgerPanelProps) {
  const rows = buildLedgerRows(slices, activeId);
  const openFindingCount = rows.reduce((total, row) => total + row.openCount, 0);
  const remainingReviewCount = rows.filter((row) => row.status === "active" || (row.status === "idle" && !row.quiet)).length;
  const visibleRows = rows.filter((row) => !row.quiet);
  const quietRows = rows.filter((row) => row.quiet);

  return (
    <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden border-l bg-card">
      <section className="min-h-0 overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisions</h3>
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
            {openFindingCount} open
          </span>
        </div>
        {visibleRows.length > 0 ? (
          <ol className="grid gap-1">
            {visibleRows.map((row) => (
              <DecisionRow key={row.id} row={row} onSelect={onSelect} />
            ))}
          </ol>
        ) : (
          <div className="rounded-md border bg-muted/35 p-3">
            <div className="text-sm font-medium">No open findings</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              The remaining slices only need a quick safe/defer pass.
            </p>
          </div>
        )}

        {quietRows.length > 0 ? (
          <details className="group mt-3 rounded-md border bg-background/70" open={visibleRows.length === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
              <span className="min-w-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                No open findings
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {quietRows.length}
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <ol className="grid gap-1 border-t p-1.5">
              {quietRows.map((row) => (
                <DecisionRow key={row.id} row={row} onSelect={onSelect} compact />
              ))}
            </ol>
          </details>
        ) : null}

        {pendingSliceCount > 0 ? <PendingDecisionGhosts count={pendingSliceCount} /> : null}
      </section>

      <ReviewPacketCard
        queuedComments={queuedComments}
        keptLocalCount={deferredSlices.length}
        openFindingCount={openFindingCount}
        remainingReviewCount={remainingReviewCount}
        readyToPreview={reviewComplete}
        active={summaryActive}
        onSelect={onSelectSummary}
      />
    </aside>
  );
}

function PendingDecisionGhosts({ count }: { count: number }) {
  const ghostKeys = pendingGhostKeys(count);

  return (
    <section className="mt-3 rounded-md border border-dashed bg-background/55 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          Analyzing more
        </span>
        <span className="text-xs text-muted-foreground">
          {count} pending
        </span>
      </div>
      <div className="grid gap-1.5">
        {ghostKeys.map((key) => (
          <div
            key={key}
            className="anvil-pending-ghost grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-md bg-muted/35 px-2.5 py-2.5"
          >
            <span className="mt-0.5 size-5 rounded-full border bg-background/70" />
            <span className="grid min-w-0 gap-1.5">
              <span className="h-3 w-3/4 rounded bg-muted-foreground/20" />
              <span className="h-2.5 w-1/2 rounded bg-muted-foreground/15" />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function pendingGhostKeys(count: number) {
  return ["first", "second", "third"].slice(0, Math.min(count, 3));
}

function DecisionRow({
  row,
  compact = false,
  onSelect,
}: {
  row: LedgerRow;
  compact?: boolean;
  onSelect: (sliceId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.sliceId)}
      className={cn(
        "grid w-full grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-accent",
        compact ? "py-2" : "py-2.5",
        row.status === "active" && "bg-primary/[0.055] hover:bg-primary/[0.075]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-5 place-items-center rounded-full border text-[10px]",
          row.status === "done" && "border-anvil-success/25 bg-anvil-success/10 text-anvil-success",
          row.status === "active" && "border-primary/30 bg-primary/10 text-primary",
          row.status === "idle" && "border-border bg-background text-muted-foreground",
          row.status === "deferred" && "border-border bg-muted text-muted-foreground",
        )}
      >
        {row.status === "done" ? <CheckCircle2 className="size-3.5" /> : null}
        {row.status === "deferred" ? <Minus className="size-3.5" /> : null}
        {row.status === "active" ? <CircleAlert className="size-3.5" /> : null}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate font-medium leading-5",
            compact ? "text-xs" : "text-sm",
            (row.status === "done" || row.status === "deferred" || row.quiet) && "text-muted-foreground",
          )}
        >
          {row.title}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-xs text-muted-foreground",
            row.openCount > 0 && "text-anvil-attention",
          )}
        >
          {row.detail}
        </span>
      </span>
    </button>
  );
}

function ReviewPacketCard({
  queuedComments,
  keptLocalCount,
  openFindingCount,
  remainingReviewCount,
  readyToPreview,
  active,
  onSelect,
}: {
  queuedComments: ReviewProgressComment[];
  keptLocalCount: number;
  openFindingCount: number;
  remainingReviewCount: number;
  readyToPreview: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const queuedCount = queuedComments.length;
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review packet</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {queuedCount > 0
              ? `${queuedCount} Anvil comment${queuedCount === 1 ? "" : "s"} staged for provider submit.`
              : "No Anvil comments staged yet."}
          </p>
        </div>
        <Badge
          className={
            readyToPreview
              ? "border-anvil-success/25 bg-anvil-success/10 text-anvil-success"
              : "border-border bg-background text-muted-foreground"
          }
        >
          {readyToPreview ? "ready" : "not ready"}
        </Badge>
      </div>
      {queuedComments.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {queuedComments.slice(0, 3).map((comment) => (
            <div key={comment.id} className="rounded-md bg-muted/45 px-2.5 py-2 text-xs">
              <div className="mb-1 flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                <code className="truncate font-mono text-primary">
                  {comment.file}:{comment.line}
                </code>
              </div>
              <p className="line-clamp-2 text-muted-foreground">{comment.draft || comment.body}</p>
            </div>
          ))}
        </div>
      ) : null}
      {!readyToPreview ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {openFindingCount > 0
            ? `Resolve ${openFindingCount} open finding${openFindingCount === 1 ? "" : "s"} to build the submission packet.`
            : `Finish ${remainingReviewCount} remaining slice review${remainingReviewCount === 1 ? "" : "s"} to build the submission packet.`}
        </p>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Review {queuedCount} staged comment{queuedCount === 1 ? "" : "s"} and {keptLocalCount} local decision
          {keptLocalCount === 1 ? "" : "s"} before submitting.
        </p>
      )}
    </>
  );

  if (readyToPreview) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "border-t bg-card p-4 text-left transition-colors hover:bg-accent",
          active && "border-primary/25 bg-primary/5 shadow-md hover:bg-primary/5",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <section className="border-t bg-card p-4">
      {content}
    </section>
  );
}

function buildLedgerRows(slices: ReviewProgressSlice[], activeId: string): LedgerRow[] {
  return slices.map((slice) => {
    const queuedCount = slice.comments.filter((comment) => comment.decision === "converted").length;
    const handledCount = slice.comments.filter(
      (comment) => comment.decision === "dismissed" || comment.decision === "resolved",
    ).length;
    const openCount = slice.comments.filter((comment) => comment.decision === "open").length;

    if (queuedCount > 0) {
      return {
        id: `${slice.id}:queued`,
        sliceId: slice.id,
        title: slice.title,
        detail: `${queuedCount} comment${queuedCount === 1 ? "" : "s"} selected`,
        status: "done" as const,
        openCount,
        quiet: false,
      };
    }

    if (slice.deferred) {
      return {
        id: `${slice.id}:deferred`,
        sliceId: slice.id,
        title: slice.title,
        detail: "Deferred",
        status: "deferred" as const,
        openCount,
        quiet: false,
      };
    }

    if (slice.reviewed || handledCount > 0) {
      return {
        id: `${slice.id}:done`,
        sliceId: slice.id,
        title: slice.title,
        detail: handledCount > 0 ? `${handledCount} finding${handledCount === 1 ? "" : "s"} handled` : "Looks safe",
        status: "done" as const,
        openCount,
        quiet: openCount === 0,
      };
    }

    const current = slice.id === activeId;
    const hasOpenFindings = openCount > 0;
    return {
      id: `${slice.id}:open`,
      sliceId: slice.id,
      title: slice.title,
      detail: current
        ? hasOpenFindings
          ? `${openCount} open finding${openCount === 1 ? "" : "s"}`
          : "Current slice"
        : `${openCount} open finding${openCount === 1 ? "" : "s"}`,
      status: current ? ("active" as const) : ("idle" as const),
      openCount,
      quiet: !current && !hasOpenFindings,
    };
  });
}
