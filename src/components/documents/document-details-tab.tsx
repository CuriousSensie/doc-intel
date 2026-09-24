"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { CustomFieldPicker } from "@/components/documents/custom-field-picker";
import { PaperlessMetaPicker } from "@/components/documents/paperless-meta-picker";
import { DocumentCustomFieldInput } from "@/components/documents/document-custom-field-input";
import { Input } from "@/components/ui/input";
import { toDocumentTypeKey, type PaperlessCorrespondent, type PaperlessDocumentType, type PaperlessTag } from "@/lib/paperless/documents";
import type { CustomFieldDataType } from "@/modules/attributes/attributes.schemas";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import type { DocumentDetails } from "@/modules/documents/documents.service";
import type { DocumentDraft } from "@/components/documents/document-detail-shell";

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Purely presentational — draft state, its baseline, and the save/discard bar all live in
// DocumentDetailShell now (the page-level "one save button for the whole document" ask), not
// here. This component just renders fields bound to `draft` and reports edits upward.
export function DocumentDetailsTab({
  document,
  draft,
  onDraftChange,
  tagOptions,
  correspondentOptions,
  documentTypeOptions,
  customFieldDefs,
  onTagCreated,
  onCorrespondentCreated,
  onDocumentTypeCreated,
  onCustomFieldDefCreated,
  readOnly = false
}: {
  document: DocumentDetails;
  draft: DocumentDraft;
  onDraftChange: (next: Partial<DocumentDraft>) => void;
  tagOptions: PaperlessTag[];
  correspondentOptions: PaperlessCorrespondent[];
  documentTypeOptions: PaperlessDocumentType[];
  customFieldDefs: CustomFieldDef[];
  onTagCreated: (tag: PaperlessTag) => void;
  onCorrespondentCreated: (c: PaperlessCorrespondent) => void;
  onDocumentTypeCreated: (dt: PaperlessDocumentType) => void;
  onCustomFieldDefCreated: (def: CustomFieldDef) => void;
  // View-only access (a 'view' share, or a read-only member): fields render but can't change.
  readOnly?: boolean;
}) {
  const t = useTranslations("documents.detail");
  const tPicker = useTranslations("documents.detail.picker");
  const tAttributes = useTranslations("common.attributes");

  // Which fields show a value input — initialized from whichever fields already have a value
  // (matches how tag/type chips already show what's assigned), then grows as the user picks
  // more from CustomFieldPicker. Previously every applicable def was always shown, filled or
  // not — the flat list this replaces.
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() =>
    customFieldDefs
      .filter((def) => {
        const value = draft.customFieldValues[def.key];
        return value !== undefined && value !== null && value !== "";
      })
      .map((def) => def.key)
  );

  const visibleDefs = customFieldDefs.filter((def) => visibleKeys.includes(def.key));
  const availableDefs = customFieldDefs.filter((def) => !visibleKeys.includes(def.key));
  const documentTypeKeyOptions = useMemo(
    () => documentTypeOptions.map((dt) => ({ key: toDocumentTypeKey(dt.name), name: dt.name })),
    [documentTypeOptions]
  );
  const dataTypeLabels: Record<CustomFieldDataType, string> = {
    string: tAttributes("dataTypes.string"),
    integer: tAttributes("dataTypes.integer"),
    float: tAttributes("dataTypes.float"),
    monetary: tAttributes("dataTypes.monetary"),
    date: tAttributes("dataTypes.date"),
    boolean: tAttributes("dataTypes.boolean"),
    select: tAttributes("dataTypes.select"),
    documentlink: tAttributes("dataTypes.documentlink"),
    url: tAttributes("dataTypes.url")
  };

  return (
    <div className="grid gap-5 pb-4">
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("titleField")}</span>
        <Input disabled={readOnly} onChange={(e) => onDraftChange({ title: e.target.value })} value={draft.title} />
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("date")}</span>
        <p className="text-sm">
          {document.document_date ? new Date(document.document_date).toLocaleDateString("sl-SI") : "—"}
        </p>
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("type")}</span>
        <PaperlessMetaPicker
          disabled={readOnly}
          kind="documentType"
          mode="single"
          onChange={(ids, created) => {
            if (created) onDocumentTypeCreated(created);
            onDraftChange({ documentTypeId: ids[0] ?? null });
          }}
          options={documentTypeOptions}
          value={draft.documentTypeId ? [draft.documentTypeId] : []}
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("correspondent")}</span>
        <PaperlessMetaPicker
          disabled={readOnly}
          kind="correspondent"
          mode="single"
          onChange={(ids, created) => {
            if (created) onCorrespondentCreated(created);
            onDraftChange({ correspondentId: ids[0] ?? null });
          }}
          options={correspondentOptions}
          value={draft.correspondentId ? [draft.correspondentId] : []}
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("tags")}</span>
        <PaperlessMetaPicker
          disabled={readOnly}
          kind="tag"
          mode="multi"
          onChange={(ids, created) => {
            // kind="tag" guarantees a full {id,name,color,text_color} shape — createPaperlessTag's
            // own return type — the picker's shared MetaOption type just doesn't encode that per-kind.
            if (created) onTagCreated(created as PaperlessTag);
            onDraftChange({ tagIds: ids });
          }}
          options={tagOptions}
          value={draft.tagIds}
        />
      </div>

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3 border-t border-border pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("customFields")}
          </span>

          <CustomFieldPicker
            availableDefs={availableDefs}
            dataTypeLabels={dataTypeLabels}
            disabled={readOnly}
            documentTypeKey={document.document_type_key}
            documentTypeOptions={documentTypeKeyOptions}
            onCreated={(def) => {
              onCustomFieldDefCreated(def);
              setVisibleKeys((prev) => [...prev, def.key]);
            }}
            onRemove={(key) => {
              setVisibleKeys((prev) => prev.filter((k) => k !== key));
              const nextValues = { ...draft.customFieldValues };
              delete nextValues[key];
              onDraftChange({ customFieldValues: nextValues });
            }}
            onSelect={(def) => setVisibleKeys((prev) => [...prev, def.key])}
            visibleDefs={visibleDefs}
            labels={{
              add: tPicker("add"),
              searchPlaceholder: tPicker("searchPlaceholder"),
              createNew: (name) => tPicker("createNew", { name }),
              creating: tPicker("creating"),
              createFailed: tPicker("createFailed"),
              done: tPicker("done"),
              remove: (name) => tPicker("remove", { name }),
              createTitle: t("customFieldPicker.createTitle"),
              createDescription: tAttributes("customFieldFormDescription"),
              formName: tAttributes("form.name"),
              formCreate: tAttributes("form.create"),
              formSave: tAttributes("form.save"),
              formCancel: tAttributes("form.cancel"),
              formDataType: tAttributes("form.dataType"),
              formDataTypeImmutableHint: tAttributes("form.dataTypeImmutableHint"),
              formOptions: tAttributes("form.options"),
              formOptionsHint: tAttributes("form.optionsHint"),
              formOptionPlaceholder: tAttributes("form.optionPlaceholder"),
              formAddOption: tAttributes("form.addOption"),
              formRemoveOption: tAttributes("form.removeOption"),
              formScope: tAttributes("form.scope"),
              formScopeGlobal: tAttributes("form.scopeGlobal"),
              formScopeGlobalHint: tAttributes("form.scopeGlobalHint"),
              formScopeDocumentTypes: tAttributes("form.scopeDocumentTypes"),
              formDocumentTypesSearchPlaceholder: tAttributes("form.documentTypesSearchPlaceholder"),
              formDocumentTypesEmpty: tAttributes("form.documentTypesEmpty")
            }}
          />

          {visibleDefs.length > 0 ? (
            <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0" disabled={readOnly}>
              {visibleDefs.map((def) => (
                <label className="grid gap-1.5 text-sm font-medium" key={def.id}>
                  <span>{def.label}</span>
                  <DocumentCustomFieldInput
                    def={def}
                    onChange={(next) =>
                      onDraftChange({
                        customFieldValues: { ...draft.customFieldValues, [def.key]: next }
                      })
                    }
                    value={draft.customFieldValues[def.key]}
                  />
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("mimeType")}</span>
          <p className="mt-0.5">{document.mime_type ?? "—"}</p>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("fileSize")}</span>
          <p className="mt-0.5">{formatSize(document.byte_size)}</p>
        </div>
        <div className="col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("originalFileName")}</span>
          <p className="mt-0.5 break-all">{document.paperless?.originalFileName ?? "—"}</p>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("pages")}</span>
          <p className="mt-0.5">{document.page_count ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
