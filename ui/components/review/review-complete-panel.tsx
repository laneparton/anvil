import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ReviewCompleteSection = {
  title: string;
  items: string[];
  emptyMessage?: string;
};

export type ReviewCompletePanelProps = {
  queuedCount: number;
  dismissedCount: number;
  fixedCount: number;
  unresolvedQuestionCount: number;
  deferredCount?: number;
  acknowledgedDeferredCount?: number;
  highRiskPendingCount?: number;
  className?: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  sections?: ReviewCompleteSection[];
  onSubmitReview?: () => void;
};

export function ReviewCompletePanel({
  queuedCount,
  dismissedCount,
  fixedCount,
  unresolvedQuestionCount,
  deferredCount = 0,
  acknowledgedDeferredCount = 0,
  highRiskPendingCount = 0,
  className,
  submitLabel = "Submit review",
  submitDisabled,
  sections = [],
  onSubmitReview,
}: ReviewCompletePanelProps) {
  const hasBlockingUnresolved = unresolvedQuestionCount > 0 || highRiskPendingCount > 0;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="space-y-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-5 text-foreground">Review complete</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Submit queued comments or approve after confirming questions and deferred slices.
            </p>
          </div>
          <Badge
            className={cn(
              "shrink-0",
              hasBlockingUnresolved
                ? "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention"
                : "border-primary/25 bg-primary/10 text-primary",
            )}
          >
            {highRiskPendingCount > 0 ? "High risk pending" : hasBlockingUnresolved ? "Questions" : "Ready"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <CountTile label="Queued" value={queuedCount} tone="primary" />
          <CountTile label="Fixed" value={fixedCount} tone="success" />
          <CountTile label="Dismissed" value={dismissedCount} tone="neutral" />
          <CountTile label="Questions" value={unresolvedQuestionCount} tone={hasBlockingUnresolved ? "warn" : "neutral"} />
          <CountTile label="Deferred" value={deferredCount} detail={`${acknowledgedDeferredCount} ack`} tone={deferredCount > acknowledgedDeferredCount ? "warn" : "neutral"} />
        </div>

        {sections.length > 0 && (
          <div className="grid gap-3">
            {sections.map((section) => (
              <section key={section.title} className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">{section.title}</h3>
                {section.items.length > 0 ? (
                  <ul className="grid gap-1">
                    {section.items.map((item) => (
                      <li key={item} className="rounded-md border border-border px-2 py-1.5 text-xs leading-5 text-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">{section.emptyMessage ?? "None."}</p>
                )}
              </section>
            ))}
          </div>
        )}

        <Button
          type="button"
          className="w-full border-border bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onSubmitReview}
          disabled={submitDisabled || !onSubmitReview}
        >
          {submitLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

function CountTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail?: string;
  tone: "primary" | "success" | "warn" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-2",
        tone === "primary" && "border-anvil-info/25 bg-anvil-info/10",
        tone === "success" && "border-primary/25 bg-primary/10",
        tone === "warn" && "border-anvil-attention/30 bg-anvil-attention/10",
        tone === "neutral" && "border-border bg-background",
      )}
    >
      <div className="text-lg font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      {detail ? <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div> : null}
    </div>
  );
}
