"use client";

import { SharedWithYouBadge } from "@/components/documents/shared-with-you-badge";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useRef, useState } from "react";

import { DocumentRowActions } from "@/components/documents/document-row-actions";
import { folderLeafName } from "@/components/documents/document-list-view";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentTagChips } from "@/components/documents/document-tag-chips";
import type { PaperlessTag } from "@/lib/paperless/documents";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import { formatCustomFieldValue } from "@/modules/custom-fields/custom-field-values";
import type { DocumentListField } from "@/modules/documents/documents.schemas";
import type { Document } from "@/modules/documents/documents.service";

function Thumbnail({ documentId, title }: { documentId: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex aspect-[3/4] w-full shrink-0 items-center justify-center rounded-md bg-panel-strong md:h-56 md:w-40">
        <FileText aria-hidden="true" className="size-8 text-muted" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy route, not a static asset.
    <img
      alt={title}
      className="aspect-[3/4] w-full shrink-0 rounded-md border border-border object-cover md:h-56 md:w-40"
      loading="lazy"
      onError={() => setFailed(true)}
      src={`/api/documents/${documentId}/thumbnail`}
    />
  );
}

// Paperless-ngx "Large Cards": one per row, thumbnail on the left, title + metadata + the first
// few lines of content on the right. `contentByPaperlessId` is fetched page-scoped by the
// server component (getPaperlessContentSnippets) — never mirrored, see that function's comment.
export function DocumentLargeCardsView({
  documents,
  selectedIds,
  sharedIds,
  onToggle,
  contentByPaperlessId,
  ctxQuery = "",
  tagsByDocumentId = {},
  customFieldDefs = [],
  customFieldValuesByDocumentId = {},
  visibleFields
}: {
  documents: Document[];
  selectedIds: Set<string>;
  sharedIds?: Set<string>;
  onToggle: (id: string) => void;
  contentByPaperlessId: Record<number, string>;
  ctxQuery?: string;
  tagsByDocumentId?: Record<string, PaperlessTag[]>;
  customFieldDefs?: CustomFieldDef[];
  customFieldValuesByDocumentId?: Record<string, Record<string, unknown>>;
  visibleFields: DocumentListField[];
}) {
  const t = useTranslations("documents");
  const tFilters = useTranslations("documents.filters");
  const router = useRouter();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = new Set(visibleFields);

  function detailHref(documentId: string) {
    return `/dashboard/documents/${documentId}${ctxQuery}`;
  }

  function handleClick(documentId: string) {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      onToggle(documentId);
      clickTimer.current = null;
    }, 180);
  }

  function handleDoubleClick(documentId: string) {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    router.push(detailHref(documentId));
  }

  return (
    <section className="grid min-w-0 gap-3">
      {documents.map((document) => {
        const content = contentByPaperlessId[document.paperless_document_id];
        const snippet = content
          ? content
              .split(/\r?\n/)
              .filter((line) => line.trim().length > 0)
              .slice(0, 4)
              .join(" ")
          : null;

        return (
          <div
            className="flex min-w-0 cursor-pointer flex-col gap-3 overflow-hidden rounded-lg border border-border bg-panel p-3 shadow-sm transition-colors hover:bg-panel-strong/40 data-[selected=true]:bg-panel-strong md:flex-row"
            data-document-row={document.id}
            data-selected={selectedIds.has(document.id)}
            key={document.id}
            onClick={() => handleClick(document.id)}
            onDoubleClick={() => handleDoubleClick(document.id)}
          >
            {selectedIds.has(document.id) ? (
              <input checked className="mt-1 size-4 shrink-0" readOnly type="checkbox" />
            ) : null}
            <div className="relative min-w-0 shrink-0 md:w-40">
              <Thumbnail documentId={document.id} title={document.title} />
              {visible.has("tags") ? (
                <div className="absolute left-2 top-2 max-w-[calc(100%-1rem)]">
                  <DocumentTagChips max={3} tags={tagsByDocumentId[document.id] ?? []} />
                </div>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                {visible.has("title") ? (
                  <div className="flex min-w-0 flex-col">
                    <p className="min-w-0 truncate text-lg font-semibold" title={document.title}>
                      {document.title}
                    </p>
                    {sharedIds?.has(document.id) ? <SharedWithYouBadge /> : null}
                  </div>
                ) : (
                  <span />
                )}
                <DocumentStatusBadge status={document.status} />
              </div>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {visible.has("documentType") ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {tFilters("field_documentType")}
                    </dt>
                    <dd className="mt-0.5 min-w-0 truncate">
                      {document.document_type_key ?? t("list.uncategorized")}
                    </dd>
                  </div>
                ) : null}
                {visible.has("folder") ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {tFilters("field_folder")}
                    </dt>
                    <dd className="mt-0.5 min-w-0 truncate" title={document.folder_path ?? undefined}>
                      {document.folder_path ? folderLeafName(document.folder_path) : t("list.unfiled")}
                    </dd>
                  </div>
                ) : null}
                {visible.has("pages") ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {tFilters("field_pages")}
                    </dt>
                    <dd className="mt-0.5">{document.page_count ?? "—"}</dd>
                  </div>
                ) : null}
                {visible.has("createdAt") ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {tFilters("field_createdAt")}
                    </dt>
                    <dd className="mt-0.5">{new Date(document.created_at).toLocaleString()}</dd>
                  </div>
                ) : null}
                {customFieldDefs.map((def) => (
                  <div key={def.id}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {def.label}
                    </dt>
                    <dd className="mt-0.5 min-w-0 truncate">
                      {formatCustomFieldValue(def, customFieldValuesByDocumentId[document.id]?.[def.key])}
                    </dd>
                  </div>
                ))}
              </dl>
              {snippet ? <p className="mt-1 line-clamp-3 text-sm text-muted">{snippet}</p> : null}
              <div className="mt-auto pt-2">
                <DocumentRowActions documentId={document.id} title={document.title} detailHref={detailHref(document.id)} />
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
