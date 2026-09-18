import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export type StatRow = {
  key: string;
  label: string;
  value: number | string | null;
  href?: string;
  badgeVariant?: BadgeProps["variant"];
};

// Compact row-list stats style (label left, pill value right) — replaces the earlier grid-of-
// tiles design per design feedback; used for every stats section across both dashboards.
export function StatsList({ rows }: { rows: StatRow[] }) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => {
        const content = (
          <div className="flex items-center justify-between gap-3 rounded-md bg-panel-strong/50 px-3 py-2">
            <span className="truncate text-sm text-muted">{row.label}</span>
            {row.value === null ? (
              <Skeleton className="h-5 w-9 rounded-full" />
            ) : (
              <Badge variant={row.badgeVariant ?? "muted"}>{row.value}</Badge>
            )}
          </div>
        );

        return row.href && row.value !== null ? (
          <Link className="transition-opacity hover:opacity-80" href={row.href} key={row.key}>
            {content}
          </Link>
        ) : (
          <div key={row.key}>{content}</div>
        );
      })}
    </div>
  );
}

// A titled sub-section within a Stats card (e.g. "Organization" vs. "Member — Jane Doe") —
// `action` is for a control that belongs to the group header, like the owner's member-picker.
export function StatGroup({
  title,
  action,
  rows
}: {
  title?: string;
  action?: ReactNode;
  rows: StatRow[];
}) {
  return (
    <div className="grid gap-2">
      {title || action ? (
        <div className="flex items-center justify-between gap-2">
          {title ? (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <StatsList rows={rows} />
    </div>
  );
}
