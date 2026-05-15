import type { QueuePullRequest } from "./types";
import { cn } from "@/lib/utils";

export function QueueStatusDot({ pullRequest }: { pullRequest: QueuePullRequest }) {
  return (
    <span
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        pullRequest.needsReview
          ? "bg-primary"
          : pullRequest.isAssignedToMe
            ? "bg-anvil-info"
            : "bg-muted-foreground/55",
      )}
    />
  );
}

export function QueueStatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs font-semibold capitalize text-muted-foreground">
      {status || "open"}
    </span>
  );
}
