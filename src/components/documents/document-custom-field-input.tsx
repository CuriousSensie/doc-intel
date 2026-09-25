"use client";

import { Input } from "@/components/ui/input";
import { getSelectOptions } from "@/modules/custom-fields/custom-field-values";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function DocumentCustomFieldInput({
  def,
  value,
  onChange
}: {
  def: CustomFieldDef;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (def.data_type === "boolean") {
    return (
      <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
        <input
          checked={Boolean(value)}
          className="size-4"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        {Boolean(value) ? "Yes" : "No"}
      </label>
    );
  }

  if (def.data_type === "select") {
    return (
      <select
        className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
        onChange={(event) => onChange(event.target.value || null)}
        value={stringValue(value)}
      >
        <option value="">—</option>
        {getSelectOptions(def).map((option) => (
          <option key={option.id ?? option.label} value={option.id ?? option.label}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const numeric = def.data_type === "integer" || def.data_type === "float" || def.data_type === "monetary";

  return (
    <Input
      onChange={(event) => {
        const next = event.target.value;
        if (next === "") onChange(null);
        else if (numeric) onChange(def.data_type === "integer" ? Number.parseInt(next, 10) : Number(next));
        else onChange(next);
      }}
      step={def.data_type === "integer" ? "1" : numeric ? "any" : undefined}
      type={numeric ? "number" : def.data_type === "date" ? "date" : def.data_type === "url" ? "url" : "text"}
      value={stringValue(value)}
    />
  );
}
