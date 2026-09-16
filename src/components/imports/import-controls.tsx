"use client";
import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import type { ColumnPreview } from "@/lib/import/parse";

export const controlClass =
  "min-h-11 w-full min-w-0 rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <select id={id} className={controlClass} {...props}>
        {children}
      </select>
    </div>
  );
}
export function ColumnField({
  label,
  columns,
  value,
  onChange,
  required = false
}: {
  label: string;
  columns: ColumnPreview[];
  value?: number;
  onChange: (value: number | undefined) => void;
  required?: boolean;
}) {
  const t = useTranslations("imports");
  const sample = columns
    .find((column) => column.index === value)
    ?.sample.filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  return (
    <div className="min-w-0">
      <SelectField
        label={label}
        required={required}
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : Number(event.target.value))
        }
      >
        <option value="">{t(required ? "chooseColumn" : "doNotImport")}</option>
        {columns.map((column) => (
          <option key={column.index} value={column.index}>
            {column.header || t("unnamedColumn", { number: column.index + 1 })}
          </option>
        ))}
      </SelectField>
      {sample && (
        <p className="mt-1.5 truncate text-xs text-muted" title={sample}>
          {sample}
        </p>
      )}
    </div>
  );
}
export function Status({
  status
}: {
  status: import("@/modules/imports/imports.service").ImportJob["status"];
}) {
  const t = useTranslations("imports.status");
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap text-sm ${["failed", "completed_with_errors"].includes(status) ? "text-danger" : status === "completed" ? "text-accent" : "text-muted"}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(status)}
    </span>
  );
}
