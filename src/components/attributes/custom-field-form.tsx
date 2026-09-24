"use client";

import { useMemo, useState } from "react";

import { CustomFieldFormControls } from "@/components/attributes/custom-field-form-controls";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CustomFieldDataType } from "@/modules/attributes/attributes.schemas";
import type { AttributeRow } from "@/modules/attributes/attributes.service";

// Extracted out of the /custom-fields page so the document sidebar's inline "create a new
// field" popup (custom-field-picker.tsx) can reuse the exact same form instead of a second,
// slimmer one — a custom field def needs a data type (+ options for `select`) and is immutable
// after creation, so unlike tags/document types this can't be a one-line inline create.
export function CustomFieldForm({
  action,
  editing,
  defaultName,
  defaultAppliesTo,
  documentTypeOptions,
  labels,
  dataTypeLabels,
  cancelControl
}: {
  action: (formData: FormData) => void | Promise<void>;
  editing?: Pick<AttributeRow, "id" | "name" | "dataType" | "options" | "appliesTo">;
  defaultName?: string;
  // Used only for a brand-new def (no `editing`) — e.g. the document sidebar's create-from-
  // picker flow defaults to "scoped to the current document's type" instead of global.
  defaultAppliesTo?: string[];
  documentTypeOptions: Array<{ key: string; name: string }>;
  labels: {
    name: string;
    create: string;
    save: string;
    cancel: string;
    dataType: string;
    dataTypeImmutableHint: string;
    options: string;
    optionsHint: string;
    optionPlaceholder: string;
    addOption: string;
    removeOption: string;
    scope: string;
    scopeGlobal: string;
    scopeGlobalHint: string;
    scopeDocumentTypes: string;
    documentTypesSearchPlaceholder: string;
    documentTypesEmpty: string;
  };
  dataTypeLabels: Record<CustomFieldDataType, string>;
  cancelControl: React.ReactNode;
}) {
  const initialAppliesTo = editing?.appliesTo ?? defaultAppliesTo ?? [];
  const [scope, setScope] = useState<"global" | "scoped">(
    initialAppliesTo.length > 0 ? "scoped" : "global"
  );
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initialAppliesTo);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rest = documentTypeOptions.filter((dt) => !selectedKeys.includes(dt.key));
    return q ? rest.filter((dt) => dt.name.toLowerCase().includes(q)) : rest;
  }, [documentTypeOptions, query, selectedKeys]);

  const selected = documentTypeOptions.filter((dt) => selectedKeys.includes(dt.key));

  return (
    <form action={action} className="grid gap-4">
      <input name="kind" type="hidden" value="custom-fields" />
      {editing ? <input name="id" type="hidden" value={editing.id} /> : null}
      {scope === "scoped" ? (
        selectedKeys.map((key) => <input key={key} name="appliesTo" type="hidden" value={key} />)
      ) : null}

      <label className="grid gap-1.5 text-sm font-medium">
        <span>{labels.name}</span>
        <Input autoComplete="off" defaultValue={editing?.name ?? defaultName} maxLength={128} name="name" required />
      </label>

      <CustomFieldFormControls
        dataTypeLabels={dataTypeLabels}
        editing={Boolean(editing)}
        initialDataType={editing?.dataType ?? "string"}
        initialOptions={(editing?.options ?? []).map((option) => option.label)}
        labels={{
          dataType: labels.dataType,
          dataTypeImmutableHint: labels.dataTypeImmutableHint,
          options: labels.options,
          optionsHint: labels.optionsHint,
          optionPlaceholder: labels.optionPlaceholder,
          addOption: labels.addOption,
          removeOption: labels.removeOption
        }}
      />

      {documentTypeOptions.length > 0 ? (
        <fieldset className="grid gap-2 text-sm font-medium">
          <span>{labels.scope}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-normal">
              <input
                checked={scope === "global"}
                name="scopeKind"
                onChange={() => setScope("global")}
                type="radio"
              />
              {labels.scopeGlobal}
            </label>
            <label className="flex items-center gap-2 text-sm font-normal">
              <input
                checked={scope === "scoped"}
                name="scopeKind"
                onChange={() => setScope("scoped")}
                type="radio"
              />
              {labels.scopeDocumentTypes}
            </label>
          </div>

          {scope === "global" ? (
            <span className="text-xs font-normal text-muted">{labels.scopeGlobalHint}</span>
          ) : (
            <div className="grid gap-2 rounded-md border border-border bg-panel p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {selected.map((dt) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-panel-strong px-2 py-0.5 text-xs font-semibold"
                    key={dt.key}
                  >
                    {dt.name}
                    <button
                      aria-label={dt.name}
                      className="rounded-full hover:opacity-70"
                      onClick={() => setSelectedKeys((prev) => prev.filter((k) => k !== dt.key))}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <Input
                onChange={(e) => setQuery(e.target.value)}
                placeholder={labels.documentTypesSearchPlaceholder}
                value={query}
              />
              <ul className="grid max-h-32 gap-0.5 overflow-auto">
                {filtered.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-muted">{labels.documentTypesEmpty}</li>
                ) : (
                  filtered.map((dt) => (
                    <li key={dt.key}>
                      <button
                        className="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-panel-strong"
                        onClick={() => {
                          setSelectedKeys((prev) => [...prev, dt.key]);
                          setQuery("");
                        }}
                        type="button"
                      >
                        {dt.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </fieldset>
      ) : null}

      <DialogFooter>
        {cancelControl}
        <Button type="submit">{editing ? labels.save : labels.create}</Button>
      </DialogFooter>
    </form>
  );
}
