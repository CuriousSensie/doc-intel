"use client";

import { Tags } from "lucide-react";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { DocumentCustomFieldInput } from "@/components/documents/document-custom-field-input";
import { PaperlessMetaPicker } from "@/components/documents/paperless-meta-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import type {
  PaperlessCorrespondent,
  PaperlessDocumentType,
  PaperlessTag
} from "@/lib/paperless/documents";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import { bulkEditDocumentsAction } from "@/modules/documents/documents.actions";
import type { ListDocumentsOptions } from "@/modules/documents/documents.service";

type Selection = { documentIds?: string[]; filter?: ListDocumentsOptions };

export function BulkAssignAttributesDialog({
  selection,
  disabled,
  options,
  customFieldDefs,
  onComplete
}: {
  selection: Selection;
  disabled?: boolean;
  options: {
    tags: PaperlessTag[];
    correspondents: PaperlessCorrespondent[];
    documentTypes: PaperlessDocumentType[];
  };
  customFieldDefs: CustomFieldDef[];
  onComplete: (operationCount: number) => void;
}) {
  const t = useTranslations("documents.bulkAssign");
  const [open, setOpen] = useState(false);
  const [tagsToAdd, setTagsToAdd] = useState<number[]>([]);
  const [tagsToRemove, setTagsToRemove] = useState<number[]>([]);
  const [correspondentId, setCorrespondentId] = useState<number | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState<number | null>(null);
  const [tagOptions, setTagOptions] = useState(options.tags);
  const [correspondentOptions, setCorrespondentOptions] = useState(options.correspondents);
  const [documentTypeOptions, setDocumentTypeOptions] = useState(options.documentTypes);
  const [selectedCustomKeys, setSelectedCustomKeys] = useState<string[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedCustomDefs = selectedCustomKeys
    .map((key) => customFieldDefs.find((def) => def.key === key))
    .filter((def): def is CustomFieldDef => Boolean(def));
  const availableCustomDefs = customFieldDefs.filter((def) => !selectedCustomKeys.includes(def.key));

  function reset() {
    setTagsToAdd([]);
    setTagsToRemove([]);
    setCorrespondentId(null);
    setDocumentTypeId(null);
    setSelectedCustomKeys([]);
    setCustomValues({});
    setError(null);
  }

  function addCustomField(key: string) {
    if (!key) return;
    setSelectedCustomKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }

  function submit() {
    startTransition(async () => {
      try {
        let operations = 0;
        for (const tagId of tagsToAdd) {
          await bulkEditDocumentsAction({ ...selection, method: "add_tag", parameters: { tag: tagId } });
          operations += 1;
        }
        for (const tagId of tagsToRemove) {
          await bulkEditDocumentsAction({ ...selection, method: "remove_tag", parameters: { tag: tagId } });
          operations += 1;
        }
        if (correspondentId !== null) {
          await bulkEditDocumentsAction({
            ...selection,
            method: "set_correspondent",
            parameters: { correspondent: correspondentId }
          });
          operations += 1;
        }
        if (documentTypeId !== null) {
          await bulkEditDocumentsAction({
            ...selection,
            method: "set_document_type",
            parameters: { document_type: documentTypeId }
          });
          operations += 1;
        }
        const customAssignments: Record<string, unknown> = {};
        const removeCustomFields: number[] = [];
        for (const def of selectedCustomDefs) {
          if (!def.paperless_custom_field_id) continue;
          const value = customValues[def.key];
          if (value === null || value === undefined || value === "") removeCustomFields.push(def.paperless_custom_field_id);
          else customAssignments[String(def.paperless_custom_field_id)] = value;
        }
        if (Object.keys(customAssignments).length > 0 || removeCustomFields.length > 0) {
          await bulkEditDocumentsAction({
            ...selection,
            method: "modify_custom_fields",
            parameters: { add_custom_fields: customAssignments, remove_custom_fields: removeCustomFields }
          });
          operations += 1;
        }
        if (operations === 0) {
          setError(t("nothingSelected"));
          return;
        }
        reset();
        setOpen(false);
        onComplete(operations);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("failed"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled} size="sm" variant="outline">
          <Tags aria-hidden className="size-4" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("addTags")}</span>
            <PaperlessMetaPicker
              kind="tag"
              mode="multi"
              onChange={(ids, created) => {
                if (created) setTagOptions((prev) => [...prev, created as PaperlessTag]);
                setTagsToAdd(ids);
              }}
              options={tagOptions}
              value={tagsToAdd}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("removeTags")}</span>
            <PaperlessMetaPicker kind="tag" mode="multi" onChange={setTagsToRemove} options={tagOptions} value={tagsToRemove} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("correspondent")}</span>
              <PaperlessMetaPicker
                kind="correspondent"
                mode="single"
                onChange={(ids, created) => {
                  if (created) setCorrespondentOptions((prev) => [...prev, created as PaperlessCorrespondent]);
                  setCorrespondentId(ids[0] ?? null);
                }}
                options={correspondentOptions}
                value={correspondentId ? [correspondentId] : []}
              />
            </div>
            <div className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("documentType")}</span>
              <PaperlessMetaPicker
                kind="documentType"
                mode="single"
                onChange={(ids, created) => {
                  if (created) setDocumentTypeOptions((prev) => [...prev, created as PaperlessDocumentType]);
                  setDocumentTypeId(ids[0] ?? null);
                }}
                options={documentTypeOptions}
                value={documentTypeId ? [documentTypeId] : []}
              />
            </div>
          </div>

          <div className="grid gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <select
                className="min-h-10 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                defaultValue=""
                disabled={availableCustomDefs.length === 0}
                onChange={(event) => {
                  addCustomField(event.target.value);
                  event.target.value = "";
                }}
              >
                <option value="">{t("chooseCustomField")}</option>
                {availableCustomDefs.map((def) => (
                  <option key={def.id} value={def.key}>
                    {def.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedCustomDefs.map((def) => (
              <label className="grid gap-1.5 text-sm font-medium" key={def.id}>
                <span>{def.label}</span>
                <DocumentCustomFieldInput
                  def={def}
                  onChange={(next) => setCustomValues((prev) => ({ ...prev, [def.key]: next }))}
                  value={customValues[def.key]}
                />
              </label>
            ))}
          </div>
        </div>

        {error ? <p className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button disabled={isPending} onClick={() => setOpen(false)} type="button" variant="outline">
            {t("cancel")}
          </Button>
          <Button disabled={isPending} onClick={submit} type="button">
            {isPending ? t("saving") : t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
