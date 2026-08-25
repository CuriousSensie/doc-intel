import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  action,
  className,
  description,
  icon: Icon,
  title
}: {
  action?: ReactNode;
  className?: string;
  description?: string;
  icon?: LucideIcon;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center",
        className
      )}
    >
      {Icon ? (
        <div className="flex size-11 items-center justify-center rounded-full bg-panel-strong text-muted">
          <Icon aria-hidden="true" className="size-5" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="max-w-sm text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
