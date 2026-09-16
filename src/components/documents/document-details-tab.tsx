"use client";

import { useTranslations } from "next-intl";

import { PaperlessMetaPicker } from "@/components/documents/paperless-meta-picker";
import { Input } from "@/components/ui/input";
import type { PaperlessCorrespondent, PaperlessDocumentType, PaperlessTag } from "@/lib/paperless/documents";
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
  onTagCreated,
  onCorrespondentCreated,
  onDocumentTypeCreated
}: {
  document: DocumentDetails;
  draft: DocumentDraft;
  onDraftChange: (next: Partial<DocumentDraft>) => void;
  tagOptions: PaperlessTag[];
  correspondentOptions: PaperlessCorrespondent[];
  documentTypeOptions: PaperlessDocumentType[];
  onTagCreated: (tag: PaperlessTag) => void;
  onCorrespondentCreated: (c: PaperlessCorrespondent) => void;
  onDocumentTypeCreated: (dt: PaperlessDocumentType) => void;
}) {
  const t = useTranslations("documents.detail");

  return (
    <div className="grid gap-5 pb-4">
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("titleField")}</span>
        <Input onChange={(e) => onDraftChange({ title: e.target.value })} value={draft.title} />
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
