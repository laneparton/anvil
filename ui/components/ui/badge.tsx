import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border border-border bg-background px-2 text-[11px] font-semibold uppercase leading-none text-foreground",
        className,
      )}
      {...props}
    />
  );
}
