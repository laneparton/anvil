import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type SourceFilterButtonProps = {
  label: string;
  icon?: LucideIcon;
  selected: boolean;
  count: number;
  onClick: () => void;
};

export function SourceFilterButton({ label, icon: Icon, selected, count, onClick }: SourceFilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
        selected
          ? "border-primary/35 bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent",
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
      <span className="font-mono text-muted-foreground">{count}</span>
    </button>
  );
}
