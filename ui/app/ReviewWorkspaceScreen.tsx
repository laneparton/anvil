import type { ReactNode } from "react";
import { Settings, XCircle } from "lucide-react";

import { AppShell } from "@/app/AppShell";
import { Button } from "@/components/ui/button";

export type ReviewWorkspaceScreenProps = {
  repo: string;
  pullRequest: string | number;
  title: ReactNode;
  queue: ReactNode;
  content: ReactNode;
  rail: ReactNode;
  onExitReview: () => void;
  onOpenSettings?: () => void;
};

export function ReviewWorkspaceScreen({
  repo,
  pullRequest,
  title,
  queue,
  content,
  rail,
  onExitReview,
  onOpenSettings,
}: ReviewWorkspaceScreenProps) {
  return (
    <AppShell
      eyebrow={`${repo} #${pullRequest}`}
      title={title}
      actions={
        <>
          <Button
            type="button"
            className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onOpenSettings}
          >
            <Settings className="size-3.5" />
            Settings
          </Button>
          <Button
            type="button"
            className="h-8 border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onExitReview}
          >
            <XCircle className="size-3.5" />
            Exit review
          </Button>
        </>
      }
    >
      <section className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)_300px] overflow-hidden">
        {queue}
        {content}
        {rail}
      </section>
    </AppShell>
  );
}
