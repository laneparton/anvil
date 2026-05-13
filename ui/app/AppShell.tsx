import type { ReactNode } from "react";

import { appDescriptor, appName } from "@/app/brand";
import { AnvilMark } from "@/components/brand/AnvilMark";
import { cn } from "@/lib/utils";

type AppShellProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
};

export function AppShell({
  title,
  eyebrow,
  subtitle,
  actions,
  children,
  className,
  headerClassName,
  contentClassName,
}: AppShellProps) {
  const supportingText = eyebrow ?? subtitle ?? appDescriptor;

  return (
    <main className={cn("grid h-screen grid-rows-[64px_1fr] overflow-hidden bg-background text-foreground", className)}>
      <header className={cn("flex items-center justify-between gap-4 border-b bg-card px-5", headerClassName)}>
        <div className="flex min-w-0 items-center gap-3">
          <AnvilMark />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            {supportingText ? <div className="truncate text-xs text-muted-foreground">{supportingText}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>

      {children ? <section className={cn("min-h-0 overflow-hidden", contentClassName)}>{children}</section> : null}
    </main>
  );
}

export function AnvilAppShell({
  title = appName,
  subtitle = appDescriptor,
  ...props
}: Omit<AppShellProps, "title"> & { title?: ReactNode }) {
  return <AppShell title={title} subtitle={subtitle} {...props} />;
}
