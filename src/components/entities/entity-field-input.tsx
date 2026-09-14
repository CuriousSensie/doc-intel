import { TextField } from "@/components/forms/text-field";
import type { EntityFieldDefinition } from "@/modules/entities/field-schema";

// Native inputs, one per specs/05 field type — matches this codebase's plain-form convention
// (no client-side form library). Server Actions read these back by `field_<key>` name.
export function EntityFieldInput({
  field,
  defaultValue
}: {
  field: EntityFieldDefinition;
  defaultValue?: unknown;
}) {
  const name = `field_${field.key}`;

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input defaultChecked={Boolean(defaultValue)} name={name} type="checkbox" />
        {field.label}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="grid gap-2 text-sm font-semibold">
        <span>{field.label}</span>
        <select
          className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          name={name}
          required={field.required}
        >
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "text") {
    return (
      <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
        <span>{field.label}</span>
        <textarea
          className="min-h-20 rounded-md border border-border bg-panel px-3 py-2 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          name={name}
          required={field.required}
        />
      </label>
    );
  }

  const inputType =
    field.type === "date"
      ? "date"
      : field.type === "integer" || field.type === "decimal" || field.type === "monetary"
        ? "number"
        : field.type === "email"
          ? "email"
          : field.type === "url"
            ? "url"
            : field.type === "phone"
              ? "tel"
              : "text";

  return (
    <TextField
      defaultValue={typeof defaultValue === "string" || typeof defaultValue === "number" ? defaultValue : ""}
      label={field.label}
      name={name}
      required={field.required}
      step={field.type === "decimal" || field.type === "monetary" ? "0.01" : undefined}
      type={inputType}
    />
  );
}
