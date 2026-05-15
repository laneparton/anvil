import * as React from "react";
import { ChevronDown, ChevronRight, Inbox, ListFilter, UserCheck, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

import { filterForGroup } from "./model";
import { QueueRow } from "./QueueRow";
import type { QueueGroupDefinition, QueuePullRequest, QueueState } from "./types";

type QueueGroupProps = {
  group: QueueGroupDefinition;
  rows: QueuePullRequest[];
  selectedId?: string;
  active: boolean;
  onActivate: () => void;
  onSelect: (pullRequest: QueuePullRequest) => void;
};

export function QueueGroup({ group, rows, selectedId, active, onActivate, onSelect }: QueueGroupProps) {
  const Icon = queueGroupIcon(group.id);
  const [expanded, setExpanded] = React.useState(group.id !== "all-open");
  const containsSelected = rows.some((pullRequest) => pullRequest.id === selectedId);

  React.useEffect(() => {
    if (containsSelected && group.id !== "all-open") setExpanded(true);
  }, [containsSelected, group.id]);

  return (
    <section className="border-b">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-accent/45"
        onClick={() => {
          onActivate();
          setExpanded((current) => !current);
        }}
        aria-expanded={expanded}
        data-testid={`inbox-filter-${filterForGroup(group.id)}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-xs font-semibold uppercase tracking-wide",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {group.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{group.description}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rows.length}</span>
      </button>
      {expanded ? (
        <div className="grid">
          {rows.length > 0 ? (
            rows.map((pullRequest) => (
              <QueueRow
                key={`${group.id}:${pullRequest.id}`}
                pullRequest={pullRequest}
                selected={pullRequest.id === selectedId}
                onSelect={() => onSelect(pullRequest)}
              />
            ))
          ) : (
            <div className="px-5 pb-4 text-xs text-muted-foreground">No matching pull requests.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function queueGroupIcon(queueState: QueueState) {
  if (queueState === "created-by-me") return UserRound;
  if (queueState === "assigned-to-me") return UserCheck;
  if (queueState === "all-open") return ListFilter;
  return Inbox;
}
