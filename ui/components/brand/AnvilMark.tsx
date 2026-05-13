import { Anvil } from "lucide-react";

import { cn } from "@/lib/utils";

type AnvilMarkProps = {
  className?: string;
  iconClassName?: string;
};

export function AnvilMark({ className, iconClassName }: AnvilMarkProps) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary",
        className,
      )}
      aria-hidden="true"
    >
      <Anvil className={cn("size-5", iconClassName)} />
    </span>
  );
}
