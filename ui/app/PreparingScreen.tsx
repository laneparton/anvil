import { AlertCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { AppShell } from "@/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PrepareState } from "@/app/review-preparation";
import type { ReviewSessionEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

export type { PrepareState } from "@/app/review-preparation";

export type PreparingScreenProps = {
  state: PrepareState;
  repo: string;
  pullRequest: string;
  onCancel: () => void;
};

export function PreparingScreen({ state, repo, pullRequest, onCancel }: PreparingScreenProps) {
  const failed = state.status === "error";
  const activeEvent = state.events[state.events.length - 1];
  const activeMessage = eventMessage(activeEvent) || state.error || "Starting the review session.";
  const phases = buildPhaseTimeline(state.events, failed);
  const sliceProgress = getSliceProgress(state.events);
  const overallProgress = getOverallProgress(phases);

  return (
    <AppShell
      eyebrow={`${repo} #${pullRequest}`}
      title="Preparing review"
      actions={
        <Button
          type="button"
          className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onCancel}
          disabled={state.canceling}
        >
          {state.canceling ? "Canceling..." : "Cancel"}
        </Button>
      }
    >
      <section className="flex h-full min-h-0 justify-center overflow-y-auto p-4 sm:p-6">
        <Card className="w-full max-w-3xl self-start overflow-hidden">
          <CardHeader className="space-y-1 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{failed ? "Could not prepare review" : "Preparing review"}</h2>
              <Badge
                className={cn(
                  failed
                    ? "border-destructive/25 bg-destructive/10 text-destructive"
                    : "border-primary/25 bg-primary/10 text-primary",
                )}
              >
                {state.sessionId ? "tauri runtime" : "starting"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{activeMessage}</p>
          </CardHeader>
          <CardContent className="grid gap-4 p-5">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="truncate">{state.sessionId ?? "Waiting for session id"}</span>
                <span className="tabular-nums">{overallProgress.completed}/{overallProgress.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full transition-[width]", failed ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${Math.round((overallProgress.completed / overallProgress.total) * 100)}%` }}
                />
              </div>
            </div>

            <ol className="grid gap-2">
              {phases.map((phase) => (
                <li
                  key={phase.id}
                  className={cn(
                    "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2",
                    phase.status === "active" && "border-primary/30 bg-primary/5",
                    phase.status === "failed" && "border-destructive/30 bg-destructive/10",
                  )}
                >
                  <span className="grid size-6 place-items-center">
                    <PhaseIcon status={phase.status} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{phase.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{phase.message}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {phase.total > 1 ? `${phase.current}/${phase.total}` : phase.elapsed}
                  </span>
                </li>
              ))}
            </ol>

            {sliceProgress.total > 0 ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Slice reviews</span>
                  <span>{sliceProgress.ready}/{sliceProgress.total}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${Math.round((sliceProgress.ready / sliceProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}

            <details className="rounded-md border bg-card">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                Raw events ({state.events.length})
              </summary>
              <ScrollArea className="max-h-48 border-t">
                <ol className="grid gap-0 p-2">
                  {state.events.length > 0 ? (
                    state.events.map((event, index) => (
                      <li
                        key={`${event.at}:${event.type}:${index}`}
                        className="grid grid-cols-[5.5rem_8rem_minmax(0,1fr)] gap-3 border-b px-2 py-2 font-mono text-xs last:border-b-0"
                      >
                        <span className="text-muted-foreground">{formatEventTime(event.at)}</span>
                        <span className={cn("truncate", isFailureEvent(event.type) ? "text-destructive" : "text-primary")}>
                          {event.type}
                        </span>
                        <span className="min-w-0 break-words text-anvil-code">{eventMessage(event)}</span>
                      </li>
                    ))
                  ) : (
                    <li className="px-2 py-6 text-center text-sm text-muted-foreground">Waiting for events...</li>
                  )}
                </ol>
              </ScrollArea>
            </details>

            {state.artifacts ? (
              <div className="grid gap-1 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                <div className="truncate">Plan: {state.artifacts.uiPath}</div>
                <div className="truncate">Worktree: {state.artifacts.worktree}</div>
              </div>
            ) : null}

            {state.error ? (
              <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive">
                {state.error}
              </div>
            ) : null}
          </CardContent>
          {state.error ? null : (
            <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
              <span>The review opens as soon as the slice plan is ready.</span>
              {!failed ? <Loader2 className="size-4 animate-spin" /> : null}
            </div>
          )}
        </Card>
      </section>
    </AppShell>
  );
}

export { PreparingScreen as PreparingReview };

function eventMessage(event: ReviewSessionEvent | undefined): string {
  if (!event) return "";
  if (typeof event.message === "string" && event.message.trim()) {
    return event.message;
  }

  const data = event.data;
  if (typeof data === "object" && data !== null) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
    if (error instanceof Error && error.message.trim()) return error.message;
  }

  return "No error detail was returned.";
}

function formatEventTime(value: string | number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

type PhaseStatus = "pending" | "active" | "complete" | "failed";

type PhaseTimelineItem = {
  id: string;
  label: string;
  eventPrefixes: string[];
  completeTypes: string[];
  status: PhaseStatus;
  message: string;
  current: number;
  total: number;
  elapsed: string;
};

const PHASES: Array<Omit<PhaseTimelineItem, "status" | "message" | "current" | "total" | "elapsed">> = [
  {
    id: "setup",
    label: "Setup",
    eventPrefixes: ["metadata.fetch", "git.fetch", "context"],
    completeTypes: ["context.built"],
  },
  {
    id: "planning",
    label: "Planning",
    eventPrefixes: ["app_server", "planner", "critic", "repair"],
    completeTypes: ["planner.ready"],
  },
  {
    id: "slice-review",
    label: "Slice Reviews",
    eventPrefixes: ["slice.review", "slice.ready"],
    completeTypes: ["reducer.started", "review.plan.ready"],
  },
  {
    id: "finalize",
    label: "Finalize",
    eventPrefixes: ["reducer", "review.plan", "review.ready"],
    completeTypes: ["review.ready"],
  },
];

function buildPhaseTimeline(events: ReviewSessionEvent[], failed: boolean): PhaseTimelineItem[] {
  const activeIndex = findActivePhaseIndex(events);

  return PHASES.map((phase, index) => {
    const phaseEvents = events.filter((event) => phase.eventPrefixes.some((prefix) => event.type.startsWith(prefix)));
    const latest = phaseEvents[phaseEvents.length - 1];
    const latestData = getEventData(latest);
    const statusFromEvent = getPhaseStatus(latestData);
    const isFailed = failed && latest && isFailureEvent(latest.type);
    const complete = events.some((event) => phase.completeTypes.includes(event.type)) || phaseEvents.some((event) => event.type.endsWith(".completed"));
    const status: PhaseStatus =
      isFailed ? "failed" :
      failed && activeIndex === index ? "failed" :
      statusFromEvent === "failed" ? "failed" :
      statusFromEvent === "completed" || complete ? "complete" :
      activeIndex === index ? "active" :
      activeIndex > index ? "complete" :
      "pending";

    return {
      ...phase,
      status,
      message: phaseMessage(phase.id, phaseEvents, events, status),
      current: getNumber(latestData.current) ?? getNumber(latestData.reviewedSlices) ?? (status === "complete" ? 1 : 0),
      total: getNumber(latestData.total) ?? getNumber(latestData.totalSlices) ?? 1,
      elapsed: formatElapsed(latestData.elapsedMs),
    };
  });
}

function findActivePhaseIndex(events: ReviewSessionEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = events[index].type;
    const phaseIndex = PHASES.findIndex((phase) => phase.eventPrefixes.some((prefix) => type.startsWith(prefix)));
    if (phaseIndex >= 0) return phaseIndex;
  }

  return 0;
}

function PhaseIcon({ status }: { status: PhaseStatus }) {
  if (status === "complete") return <CheckCircle2 className="size-4 text-primary" />;
  if (status === "failed") return <AlertCircle className="size-4 text-destructive" />;
  if (status === "active") return <Loader2 className="size-4 animate-spin text-primary" />;
  return <Circle className="size-4 text-muted-foreground" />;
}

function phaseMessage(id: string, phaseEvents: ReviewSessionEvent[], allEvents: ReviewSessionEvent[], status: PhaseStatus) {
  const latest = phaseEvents[phaseEvents.length - 1];
  if (!latest) return status === "pending" ? "Waiting" : "Queued";

  if (id === "setup" && status === "complete") return "Metadata, checkout, and diff context ready.";
  if (id === "planning") {
    if (latest.type.startsWith("repair")) return "Repairing the planned slice map.";
    if (latest.type.startsWith("critic")) return "Checking the slice map before review.";
    if (latest.type === "planner.ready") return "Slice map accepted.";
  }
  if (id === "slice-review") {
    const progress = getSliceProgress(allEvents);
    if (progress.total > 0) return `${progress.ready}/${progress.total} slices reviewed.`;
  }
  if (id === "finalize" && status === "complete") return "Review artifacts ready.";

  return eventMessage(latest);
}

function getOverallProgress(phases: PhaseTimelineItem[]) {
  const total = Math.max(phases.length, 1);
  const completed = phases.filter((phase) => phase.status === "complete").length;
  return { completed, total };
}

function getSliceProgress(events: ReviewSessionEvent[]) {
  const plannerReady = [...events].reverse().find((event) => event.type === "planner.ready");
  const plannerData = getEventData(plannerReady);
  const total =
    getNumber(plannerData.total) ??
    (Array.isArray(plannerData.plannedSlices) ? plannerData.plannedSlices.length : undefined) ??
    0;
  const ready = events.filter((event) => event.type === "slice.ready").length;

  return { ready, total };
}

function getEventData(event: ReviewSessionEvent | undefined): Record<string, unknown> {
  if (typeof event?.data === "object" && event.data !== null) return event.data as Record<string, unknown>;
  return {};
}

function getPhaseStatus(data: Record<string, unknown>) {
  return typeof data.status === "string" ? data.status : undefined;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatElapsed(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function isFailureEvent(type: string) {
  return type.endsWith(".failed") || type === "review.failed" || type === "session.failed";
}
