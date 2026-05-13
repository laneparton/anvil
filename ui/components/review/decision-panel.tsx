import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { filterActionableQuestions } from "@/lib/review-questions";
import { cn } from "@/lib/utils";
import type { InlineComment, Risk, Slice, Status } from "@/lib/review-types";

type SliceAction = (slice: Slice) => void;

export type DecisionPanelProps = {
  slice: Slice;
  className?: string;
  onMarkReviewed?: SliceAction;
  onConvertComments?: SliceAction;
  onDismissFindings?: SliceAction;
  onResolveFindings?: SliceAction;
};

const statusLabels: Record<Status, string> = {
  blocked: "Blocked",
  "needs-human": "Needs human",
  "agent-reviewed": "Agent reviewed",
};

const riskLabels: Record<Risk, string> = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
};

const statusStyles: Record<Status, string> = {
  blocked: "border-destructive/25 bg-destructive/10 text-destructive",
  "needs-human": "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
  "agent-reviewed": "border-primary/25 bg-primary/10 text-primary",
};

const riskStyles: Record<Risk, string> = {
  high: "border-destructive/25 bg-destructive/10 text-destructive",
  medium: "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
  low: "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
};

function countBySeverity(comments: InlineComment[], severity: InlineComment["severity"]) {
  return comments.filter((comment) => comment.severity === severity).length;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function DecisionPanel({
  slice,
  className,
  onMarkReviewed,
  onConvertComments,
  onDismissFindings,
  onResolveFindings,
}: DecisionPanelProps) {
  const blockingComments = slice.inlineComments.filter((comment) => comment.severity === "blocking");
  const questionComments = slice.inlineComments.filter((comment) => comment.severity === "question");
  const checkComments = countBySeverity(slice.inlineComments, "check");
  const nitComments = countBySeverity(slice.inlineComments, "nit");
  const actionableQuestions = filterActionableQuestions(slice.remainingQuestions);
  const reviewedFiles = new Set(slice.filesReviewed);
  const pendingFiles = slice.files.filter((file) => !reviewedFiles.has(file));
  const hasFindings = slice.inlineComments.length > 0 || actionableQuestions.length > 0;

  return (
    <Card className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      <CardHeader className="space-y-3 px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold leading-5 text-foreground">{slice.title}</h2>
            <Badge className={cn("shrink-0", statusStyles[slice.status])}>{statusLabels[slice.status]}</Badge>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{slice.why}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className={riskStyles[slice.risk]}>{riskLabels[slice.risk]}</Badge>
          <Badge>{formatCount(slice.hunks.length, "hunk")}</Badge>
          <Badge>
            {slice.filesReviewed.length}/{slice.files.length} files reviewed
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Decision summary</h3>
            <Badge className={hasFindings ? "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention" : "border-primary/25 bg-primary/10 text-primary"}>
              {hasFindings ? "Needs decision" : "Clear"}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold leading-none text-foreground">{blockingComments.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">Blockers</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold leading-none text-foreground">{actionableQuestions.length + questionComments.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">Open questions</div>
            </div>
          </div>
          {(checkComments > 0 || nitComments > 0) && (
            <p className="text-xs leading-5 text-muted-foreground">
              Also tracking {formatCount(checkComments, "check")} and {formatCount(nitComments, "nit")}.
            </p>
          )}
        </section>

        {hasFindings && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Blockers and questions</h3>
            <ul className="space-y-2">
              {blockingComments.map((comment) => (
                <li key={`${comment.file}:${comment.hunkId}:${comment.line}:blocking`} className="rounded-md border border-destructive/25 bg-destructive/10 p-2 text-xs leading-5 text-destructive">
                  <span className="font-semibold">{comment.file}</span>
                  <span>:{comment.line}</span>
                  <p className="mt-1">{comment.body}</p>
                </li>
              ))}
              {questionComments.map((comment) => (
                <li key={`${comment.file}:${comment.hunkId}:${comment.line}:question`} className="rounded-md border border-anvil-attention/30 bg-anvil-attention/10 p-2 text-xs leading-5 text-anvil-attention">
                  <span className="font-semibold">{comment.file}</span>
                  <span>:{comment.line}</span>
                  <p className="mt-1">{comment.body}</p>
                </li>
              ))}
              {actionableQuestions.map((question) => (
                <li key={question} className="rounded-md border border-border p-2 text-xs leading-5 text-foreground">
                  {question}
                </li>
              ))}
            </ul>
          </section>
        )}

        <Separator />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Evidence checklist</h3>
          {slice.evidence.length > 0 ? (
            <ul className="space-y-2">
              {slice.evidence.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-5 text-foreground">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No evidence recorded for this slice.</p>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Files reviewed</h3>
          <ul className="space-y-1">
            {slice.filesReviewed.map((file) => (
              <li key={file} className="flex items-center justify-between gap-2 text-sm leading-5">
                <span className="truncate text-foreground">{file}</span>
                <Badge className="border-primary/25 bg-primary/10 text-primary">Reviewed</Badge>
              </li>
            ))}
            {pendingFiles.map((file) => (
              <li key={file} className="flex items-center justify-between gap-2 text-sm leading-5">
                <span className="truncate text-muted-foreground">{file}</span>
                <Badge className="border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention">Pending</Badge>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>

      <div className="space-y-2 border-t border-border p-4">
        <Button className="w-full border-border bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => onMarkReviewed?.(slice)} disabled={!onMarkReviewed}>
          Mark reviewed
        </Button>
        <Button className="w-full border-border bg-background text-foreground" onClick={() => onConvertComments?.(slice)} disabled={!onConvertComments || slice.inlineComments.length === 0}>
          Convert comments
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button className="border-border bg-background text-foreground" onClick={() => onDismissFindings?.(slice)} disabled={!onDismissFindings || !hasFindings}>
            Dismiss
          </Button>
          <Button className="border-border bg-background text-foreground" onClick={() => onResolveFindings?.(slice)} disabled={!onResolveFindings || !hasFindings}>
            Resolve
          </Button>
        </div>
      </div>
    </Card>
  );
}
