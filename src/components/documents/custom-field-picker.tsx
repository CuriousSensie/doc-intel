"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { CustomFieldForm } from "@/components/attributes/custom-field-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CustomFieldDataType } from "@/modules/attributes/attributes.schemas";
import { createCustomFieldDefAction } from "@/modules/attributes/attributes.actions";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";

// Mirrors paperless-meta-picker.tsx's UX (chips for what's assigned, "+ Add" opens a search
// panel, a "create new" row when the query has no match) but for CustomFieldDef — string `key`s
// rather than Paperless numeric ids, and "create new" can't fire synchronously like a tag
// (a field needs a data type, immutable after creation) so it opens the same form used on
// /custom-fields in a dialog instead.
export function CustomFieldPicker({
  visibleDefs,
  availableDefs,
  documentTypeOptions,
  documentTypeKey,
  onSelect,
  onRemove,
  onCreated,
  disabled,
  labels,
  dataTypeLabels
}: {
  visibleDefs: CustomFieldDef[];
  availableDefs: CustomFieldDef[];
  documentTypeOptions: Array<{ key: string; name: string }>;
  documentTypeKey: string | null;
  onSelect: (def: CustomFieldDef) => void;
  onRemove: (key: string) => void;
  onCreated: (def: CustomFieldDef) => void;
  disabled?: boolean;
  labels: {
    add: string;
    searchPlaceholder: string;
    createNew: (name: string) => string;
    creating: string;
    createFailed: string;
    done: string;
    remove: (label: string) => string;
    createTitle: string;
    createDescription: string;
    formName: string;
    formCreate: string;
    formSave: string;
    formCancel: string;
    formDataType: string;
    formDataTypeImmutableHint: string;
    formOptions: string;
    formOptionsHint: string;
    formOptionPlaceholder: string;
    formAddOption: string;
    formRemoveOption: string;
    formScope: string;
    formScopeGlobal: string;
    formScopeGlobalHint: string;
    formScopeDocumentTypes: string;
    formDocumentTypesSearchPlaceholder: string;
    formDocumentTypesEmpty: string;
  };
  dataTypeLabels: Record<CustomFieldDataType, string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? availableDefs.filter((def) => def.label.toLowerCase().includes(q)) : availableDefs;
  }, [availableDefs, query]);

  const exactMatch = availableDefs.some((def) => def.label.toLowerCase() === query.trim().toLowerCase());

  function select(def: CustomFieldDef) {
    onSelect(def);
    setQuery("");
    setOpen(false);
  }

  function submitCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createCustomFieldDefAction(formData);
        onCreated(created);
        setCreateOpen(false);
        setOpen(false);
        setQuery("");
      } catch (err) {
        setError(err instanceof Error ? err.message : labels.createFailed);
      }
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleDefs.map((def) => (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-border bg-panel-strong px-2.5 py-0.5 text-xs font-semibold"
            key={def.key}
          >
            {def.label}
            {!disabled ? (
              <button
                aria-label={labels.remove(def.label)}
                className="ml-0.5 rounded-full hover:opacity-70"
                onClick={() => onRemove(def.key)}
                type="button"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!disabled ? (
          <button
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-semibold text-muted hover:bg-panel-strong"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            <Plus className="size-3" />
            {labels.add}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="grid gap-2 rounded-md border border-border bg-panel p-2">
          <Input
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            value={query}
          />
          <ul className="grid max-h-40 gap-0.5 overflow-auto">
            {filtered.map((def) => (
              <li key={def.key}>
                <button
                  className="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-panel-strong"
                  onClick={() => select(def)}
                  type="button"
                >
                  {def.label}
                </button>
              </li>
            ))}
          </ul>
          {query.trim() && !exactMatch ? (
            <button
              className="w-full rounded-md px-2 py-1 text-left text-sm font-semibold text-accent hover:bg-panel-strong"
              onClick={() => setCreateOpen(true)}
              type="button"
            >
              {labels.createNew(query.trim())}
            </button>
          ) : null}
          <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
            {labels.done}
          </Button>
        </div>
      ) : null}

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{labels.createTitle}</DialogTitle>
          </DialogHeader>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <CustomFieldForm
            action={submitCreate}
            cancelControl={
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {labels.formCancel}
                </Button>
              </DialogClose>
            }
            dataTypeLabels={dataTypeLabels}
            defaultAppliesTo={documentTypeKey ? [documentTypeKey] : []}
            defaultName={query.trim()}
            documentTypeOptions={documentTypeOptions}
            labels={{
              name: labels.formName,
              create: isPending ? labels.creating : labels.formCreate,
              save: labels.formSave,
              cancel: labels.formCancel,
              dataType: labels.formDataType,
              dataTypeImmutableHint: labels.formDataTypeImmutableHint,
              options: labels.formOptions,
              optionsHint: labels.formOptionsHint,
              optionPlaceholder: labels.formOptionPlaceholder,
              addOption: labels.formAddOption,
              removeOption: labels.formRemoveOption,
              scope: labels.formScope,
              scopeGlobal: labels.formScopeGlobal,
              scopeGlobalHint: labels.formScopeGlobalHint,
              scopeDocumentTypes: labels.formScopeDocumentTypes,
              documentTypesSearchPlaceholder: labels.formDocumentTypesSearchPlaceholder,
              documentTypesEmpty: labels.formDocumentTypesEmpty
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
