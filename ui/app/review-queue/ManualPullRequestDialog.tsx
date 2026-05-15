import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

type ManualPullRequestDialogProps = {
  manualUrl: string;
  manualError?: string;
  onUrlChange: (value: string) => void;
  onClose: () => void;
  onPrepare: () => void;
};

export function ManualPullRequestDialog({
  manualUrl,
  manualError,
  onUrlChange,
  onClose,
  onPrepare,
}: ManualPullRequestDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-pr-title"
    >
      <div className="grid w-full max-w-lg gap-4 rounded-lg border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <h3 id="manual-pr-title" className="text-sm font-semibold">
            Open PR manually
          </h3>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <label className="grid gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pull request URL
          </span>
          <input
            value={manualUrl}
            onChange={(event) => onUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onPrepare();
            }}
            placeholder="https://bitbucket.org/workspace/repo/pull-requests/45"
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/50"
            data-testid="manual-pr-url"
          />
        </label>
        {manualError ? <div className="text-xs text-destructive">{manualError}</div> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" className="h-8 border-border bg-background px-3 text-xs hover:bg-accent" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={onPrepare}
            data-testid="manual-pr-prepare"
          >
            Prepare
          </Button>
        </div>
      </div>
    </div>
  );
}
