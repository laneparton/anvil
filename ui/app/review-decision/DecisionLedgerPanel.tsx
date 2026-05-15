import { CheckCircle2, CircleAlert, MessageSquarePlus, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ReviewProgressComment, ReviewProgressSlice } from "@/lib/review-progress";
import { cn } from "@/lib/utils";

type LedgerRow = {
  id: string;
  sliceId: string;
  title: string;
  detail: string;
  status: "done" | "active" | "idle" | "deferred";
};

type DecisionLedgerPanelProps = {
  activeId: string;
  reviewComplete: boolean;
  slices: ReviewProgressSlice[];
  queuedComments: ReviewProgressComment[];
  onSelect: (sliceId: string) => void;
  onSubmitReview: () => void;
  submitDisabled: boolean;
  submitLabel: string;
};

export function DecisionLedgerPanel({
  activeId,
  reviewComplete,
  slices,
  queuedComments,
  onSelect,
  onSubmitReview,
  submitDisabled,
  submitLabel,
}: DecisionLedgerPanelProps) {
  const rows = buildLedgerRows(slices, activeId);
  const unresolvedCount = rows.filter((row) => row.status === "idle" || row.status === "active").length;

  return (
    <aside className="grid min-h-0 content-start gap-3 overflow-y-auto border-l bg-background p-3">
      <section className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisions</h3>
          <Badge>{rows.length}</Badge>
        </div>
        <ol className="grid gap-2">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row.sliceId)}
              className={cn(
                "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
                row.status === "active" && "bg-anvil-info/10 hover:bg-anvil-info/10",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 place-items-center rounded-full border text-[10px]",
                  row.status === "done" && "border-anvil-success/25 bg-anvil-success/10 text-anvil-success",
                  row.status === "active" && "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
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
                    "block truncate text-sm leading-5",
                    (row.status === "done" || row.status === "deferred") && "text-muted-foreground",
                  )}
                >
                  {row.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{row.detail}</span>
              </span>
            </button>
          ))}
        </ol>
      </section>

      <section
        className={cn(
          "rounded-lg border bg-card p-3 shadow-sm",
          reviewComplete && "border-primary/25 bg-primary/5",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review packet</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {queuedComments.length > 0
                ? `${queuedComments.length} comment${queuedComments.length === 1 ? "" : "s"} staged for provider submit.`
                : "No comments staged yet."}
            </p>
          </div>
          <Badge
            className={
              reviewComplete
                ? "border-anvil-success/25 bg-anvil-success/10 text-anvil-success"
                : "border-border bg-background text-muted-foreground"
            }
          >
            {reviewComplete ? "ready" : "not ready"}
          </Badge>
        </div>
        {!reviewComplete ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Resolve {unresolvedCount} open decision{unresolvedCount === 1 ? "" : "s"} to build the submission packet.
          </p>
        ) : (
          <button
            type="button"
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitDisabled}
            onClick={onSubmitReview}
          >
            <MessageSquarePlus className="size-4" />
            {submitLabel}
          </button>
        )}
      </section>
    </aside>
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
      };
    }

    if (slice.reviewed || handledCount > 0) {
      return {
        id: `${slice.id}:done`,
        sliceId: slice.id,
        title: slice.title,
        detail: handledCount > 0 ? `${handledCount} finding${handledCount === 1 ? "" : "s"} handled` : "Looks safe",
        status: "done" as const,
      };
    }

    if (slice.deferred) {
      return {
        id: `${slice.id}:deferred`,
        sliceId: slice.id,
        title: slice.title,
        detail: "Deferred",
        status: "deferred" as const,
      };
    }

    return {
      id: `${slice.id}:open`,
      sliceId: slice.id,
      title: slice.title,
      detail: slice.id === activeId ? "Current decision" : `${openCount} open finding${openCount === 1 ? "" : "s"}`,
      status: slice.id === activeId ? ("active" as const) : ("idle" as const),
    };
  });
}
