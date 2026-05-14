import type { ReactNode } from "react";
import { Cloud, GitPullRequest, Settings, XCircle } from "lucide-react";

import { AppShell } from "@/app/AppShell";
import { Button } from "@/components/ui/button";
import type { ProviderPullRequestLink } from "@/lib/provider-links";
import { cn } from "@/lib/utils";

export type ReviewWorkspaceScreenProps = {
  repo: string;
  pullRequest: string | number;
  title: ReactNode;
  queue: ReactNode;
  content: ReactNode;
  rail: ReactNode;
  onExitReview: () => void;
  onOpenSettings?: () => void;
  onOpenProvider?: () => void;
  providerPullRequestLink?: ProviderPullRequestLink;
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
  onOpenProvider,
  providerPullRequestLink,
}: ReviewWorkspaceScreenProps) {
  const ProviderIcon = providerPullRequestLink?.provider === "bitbucket" ? Cloud : GitPullRequest;
  const providerTone =
    providerPullRequestLink?.provider === "bitbucket"
      ? "border-[#0052cc]/25 bg-[#0052cc]/5 text-[#253858] hover:bg-[#0052cc]/10"
      : "border-[#24292f]/20 bg-[#24292f]/5 text-[#24292f] hover:bg-[#24292f]/10";
  const providerIconTone = providerPullRequestLink?.provider === "bitbucket" ? "text-[#0052cc]" : "text-[#24292f]";

  return (
    <AppShell
      eyebrow={`${repo} #${pullRequest}`}
      title={title}
      actions={
        <>
          {providerPullRequestLink ? (
            <Button type="button" className={cn("h-8 px-2 text-xs", providerTone)} onClick={onOpenProvider}>
              <ProviderIcon className={cn("size-3.5", providerIconTone)} />
              {providerPullRequestLink.label}
            </Button>
          ) : null}
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
