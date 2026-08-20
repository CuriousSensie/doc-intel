import type { ComponentPropsWithoutRef } from "react";

export function TextField({
  label,
  hint,
  ...props
}: ComponentPropsWithoutRef<"input"> & {
  label: string;
  hint?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      <span>{label}</span>
      <input
        className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
        {...props}
      />
      {hint ? <span className="text-xs font-normal leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}
