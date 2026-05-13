import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ReviewProgressComment } from "@/lib/review-progress";
import { cn } from "@/lib/utils";

export type QueuedCommentTrayProps = {
  comments: ReviewProgressComment[];
  className?: string;
  title?: string;
  emptyMessage?: string;
  onEdit?: (comment: ReviewProgressComment) => void;
  onRemove?: (comment: ReviewProgressComment) => void;
};

const severityStyles: Record<ReviewProgressComment["severity"], string> = {
  blocking: "border-destructive/25 bg-destructive/10 text-destructive",
  question: "border-anvil-attention/30 bg-anvil-attention/10 text-anvil-attention",
  check: "border-anvil-info/25 bg-anvil-info/10 text-anvil-info",
  nit: "border-muted bg-muted text-muted-foreground",
};

export function QueuedCommentTray({
  comments,
  className,
  title = "Queued comments",
  emptyMessage = "No queued comments.",
  onEdit,
  onRemove,
}: QueuedCommentTrayProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-3 py-2">
        <h2 className="truncate text-xs font-semibold uppercase text-muted-foreground">{title}</h2>
        <Badge className="h-5 shrink-0 px-1.5 text-[10px]">{comments.length}</Badge>
      </CardHeader>

      <CardContent className="p-1.5">
        {comments.length > 0 ? (
          <ul className="grid gap-1">
            {comments.map((comment) => (
              <QueuedCommentItem
                key={comment.id}
                comment={comment}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            ))}
          </ul>
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}

function QueuedCommentItem({
  comment,
  onEdit,
  onRemove,
}: {
  comment: ReviewProgressComment;
  onEdit?: (comment: ReviewProgressComment) => void;
  onRemove?: (comment: ReviewProgressComment) => void;
}) {
  return (
    <li className="grid min-w-0 grid-cols-[1fr_auto] gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-accent/50">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{comment.file}</span>
          <span className="shrink-0 text-xs text-muted-foreground">:{comment.line}</span>
          <Badge className={cn("h-5 shrink-0 px-1.5 text-[10px]", severityStyles[comment.severity])}>
            {comment.severity}
          </Badge>
        </div>
        <p className="mt-1 truncate text-xs leading-4 text-muted-foreground">{comment.draft || comment.body}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          className="h-7 border-border bg-background px-2 py-1 text-xs text-foreground"
          onClick={() => onEdit?.(comment)}
          disabled={!onEdit}
        >
          Edit
        </Button>
        <Button
          type="button"
          className="h-7 border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onRemove?.(comment)}
          disabled={!onRemove}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}
