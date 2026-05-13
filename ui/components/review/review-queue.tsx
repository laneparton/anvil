import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReviewProgressSlice } from "@/lib/review-progress";
import { filterActionableQuestions } from "@/lib/review-questions";
import { cn } from "@/lib/utils";
import type { Risk } from "@/lib/review-types";

export type ReviewQueueProps = {
  slices: ReviewProgressSlice[];
  activeId: string | undefined;
  pendingSliceIds?: Set<string>;
  onSelect: (id: string) => void;
};

export function ReviewQueue({ slices, activeId, pendingSliceIds = new Set(), onSelect }: ReviewQueueProps) {
  const decisions = slices.reduce((total, slice) => total + countSliceWork(slice), 0);
  const pendingCount = slices.filter((slice) => pendingSliceIds.has(slice.id)).length;
  const deferredCount = slices.filter((slice) => slice.deferred).length;
  const unreviewedCount = slices.filter((slice) => !slice.reviewed && !pendingSliceIds.has(slice.id)).length;

  return (
    <aside className="p-3">
      <div className="mb-3 grid gap-2">
        <div className="px-1">
          <div className="min-w-0">
            <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review queue</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {pendingCount > 0
                ? `${pendingCount} analyzing`
                : decisions > 0
                  ? `${decisions} decisions`
                  : `${unreviewedCount} ${unreviewedCount === 1 ? "slice" : "slices"} ready`} across {slices.length} slices
              {deferredCount > 0 ? `, ${deferredCount} deferred` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-1">
        {slices.map((slice, index) => (
          <QueueItem
            key={slice.id}
            slice={slice}
            index={index}
            active={slice.id === activeId}
            pending={pendingSliceIds.has(slice.id)}
            onSelect={() => onSelect(slice.id)}
          />
        ))}
      </div>
    </aside>
  );
}

function QueueItem({ slice, index, active, pending, onSelect }: { slice: ReviewProgressSlice; index: number; active: boolean; pending: boolean; onSelect: () => void }) {
  const blockers = slice.comments.filter((comment) => comment.decision === "open" && comment.severity === "blocking").length;
  const questions = slice.reviewed ? 0 : filterActionableQuestions(slice.remainingQuestions).length;
  const ready = countSliceWork(slice) === 0;

  return (
    <Button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "h-auto w-full justify-start rounded-md border px-2 py-2 text-left hover:bg-accent",
        active ? "border-primary/40 bg-card shadow-sm" : "border-transparent bg-transparent",
      )}
    >
      <span className="grid w-full min-w-0 grid-cols-[1.25rem_1fr_auto] items-center gap-2">
        <span
          className={cn(
            "grid size-5 place-items-center rounded-md text-[11px] font-semibold",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {index + 1}
        </span>

        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <RiskDot risk={slice.risk} />
            <span className="truncate text-sm font-semibold leading-tight">{slice.title}</span>
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {pending
                ? "analyzing"
                : slice.deferred
                  ? slice.reviewed ? "deferred acknowledged" : "deferred"
                  : slice.reviewed
                    ? "reviewed"
                    : ready
                      ? "ready to finish"
                      : `${slice.hunks.length} hunks`}
            </span>
          </span>
        </span>

        <span className="flex min-w-[3rem] justify-end gap-1">
          {blockers > 0 && <CountBadge value={blockers} label="B" tone="bad" />}
          {questions > 0 && <CountBadge value={questions} label="Q" tone="warn" />}
        </span>
      </span>
    </Button>
  );
}

function CountBadge({ value, label, tone }: { value: number; label: string; tone: "bad" | "warn" | "neutral" }) {
  return (
    <Badge
      className={cn(
        "h-5 min-w-8 justify-center gap-1 px-1.5 text-[10px]",
        tone === "bad" && "border-destructive/25 bg-destructive/10 text-destructive",
        tone === "warn" && "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
        tone === "neutral" && "text-muted-foreground",
      )}
    >
      <span>{value}</span>
      <span>{label}</span>
    </Badge>
  );
}

function RiskDot({ risk }: { risk: Risk }) {
  return (
    <span
      aria-label={`${risk} risk`}
      className={cn(
        "size-2 shrink-0 rounded-full",
        risk === "high" && "bg-destructive",
        risk === "medium" && "bg-anvil-attention",
        risk === "low" && "bg-primary",
      )}
    />
  );
}

function countSliceWork(slice: ReviewProgressSlice) {
  const openComments = slice.comments.filter((comment) => comment.decision === "open").length;
  const openQuestions = slice.reviewed ? 0 : filterActionableQuestions(slice.remainingQuestions).length;
  return openComments + openQuestions;
}
