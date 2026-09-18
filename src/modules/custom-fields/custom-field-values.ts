import type { CustomFieldDef, CustomFieldSelectOption } from "@/modules/custom-fields/custom-field-defs.service";

export type KeyedCustomFieldValues = Record<string, unknown>;

export function mapRawCustomFieldValues(
  rawValues: Array<{ field: number; value: unknown }> | undefined,
  defs: CustomFieldDef[]
): KeyedCustomFieldValues {
  const keyByPaperlessFieldId = new Map(
    defs
      .filter((def) => def.paperless_custom_field_id !== null)
      .map((def) => [def.paperless_custom_field_id, def.key])
  );
  const mapped: KeyedCustomFieldValues = {};
  for (const raw of rawValues ?? []) {
    const key = keyByPaperlessFieldId.get(raw.field);
    if (key) mapped[key] = raw.value;
  }
  return mapped;
}

export function isCustomFieldApplicable(def: CustomFieldDef, documentTypeKey: string | null): boolean {
  return def.applies_to.length === 0 || Boolean(documentTypeKey && def.applies_to.includes(documentTypeKey));
}

export function getSelectOptions(def: CustomFieldDef): CustomFieldSelectOption[] {
  return Array.isArray(def.options) ? (def.options as CustomFieldSelectOption[]) : [];
}

export function formatCustomFieldValue(def: CustomFieldDef, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";

  if (def.data_type === "boolean") return value ? "Yes" : "No";
  if (def.data_type === "date" && typeof value === "string") return new Date(value).toLocaleDateString();
  if (def.data_type === "select") {
    return getSelectOptions(def).find((option) => option.id === value)?.label ?? String(value);
  }

  return String(value);
}
