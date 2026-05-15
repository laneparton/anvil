import { cn } from "@/lib/utils";

import { initialsFor, providerIcon, providerIconTone } from "./format";
import { QueueStatusDot } from "./StatusPill";
import type { QueuePullRequest } from "./types";

type QueueRowProps = {
  pullRequest: QueuePullRequest;
  selected: boolean;
  onSelect: () => void;
};

export function QueueRow({ pullRequest, selected, onSelect }: QueueRowProps) {
  const ProviderIcon = providerIcon(pullRequest.provider);

  return (
    <button
      type="button"
      className={cn(
        "grid w-full border-l-2 px-5 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/35",
        selected ? "border-l-primary bg-primary/[0.055]" : "border-l-transparent hover:bg-accent/60",
      )}
      onClick={onSelect}
      data-testid="pull-request-row"
    >
      <span className="grid min-w-0 gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <QueueStatusDot pullRequest={pullRequest} />
          <span className="min-w-0 truncate text-sm font-semibold leading-5">{pullRequest.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
          <ProviderIcon className={cn("size-3.5 shrink-0", providerIconTone(pullRequest.provider))} />
          <span className="truncate font-mono text-foreground/75">{pullRequest.repoName}</span>
          <span className="text-muted-foreground/70">#{pullRequest.number}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              {initialsFor(pullRequest.author)}
            </span>
            {pullRequest.author}
          </span>
          <span>{pullRequest.age}</span>
          {pullRequest.changedFilesCount !== undefined ? <span>{pullRequest.changedFilesCount} files</span> : null}
          {isNonOpenStatus(pullRequest.status) ? (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-medium capitalize text-muted-foreground">
              {pullRequest.status}
            </span>
          ) : null}
          {pullRequest.cacheStatus === "stale" ? (
            <span className="rounded-sm bg-anvil-attention/12 px-1.5 py-0.5 font-medium text-anvil-attention">
              stale
            </span>
          ) : pullRequest.cacheStatus === "cached" ? (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">cached</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function isNonOpenStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "open" && normalized !== "ready";
}
