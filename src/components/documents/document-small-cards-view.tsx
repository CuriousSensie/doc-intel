"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useRef, useState } from "react";

import { DocumentRowActions } from "@/components/documents/document-row-actions";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentTagChips } from "@/components/documents/document-tag-chips";
import type { PaperlessTag } from "@/lib/paperless/documents";
import type { DocumentListField } from "@/modules/documents/documents.schemas";
import type { Document } from "@/modules/documents/documents.service";

function Thumbnail({ documentId, title }: { documentId: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex aspect-[3/4] w-full items-center justify-center rounded-md bg-panel-strong">
        <FileText aria-hidden="true" className="size-8 text-muted" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy route, not a static asset Next's image optimizer could cache/rewrite.
    <img
      alt={title}
      className="aspect-[3/4] w-full rounded-md border border-border object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
      src={`/api/documents/${documentId}/thumbnail`}
    />
  );
}

// Paperless-ngx "Small Cards": thumbnail + title + metadata only, 5-7 per row, no content
// preview (that's Large Cards below).
export function DocumentSmallCardsView({
  documents,
  selectedIds,
  onToggle,
  ctxQuery = "",
  tagsByDocumentId = {},
  connectionCountsByDocumentId = {},
  visibleFields
}: {
  documents: Document[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  ctxQuery?: string;
  tagsByDocumentId?: Record<string, PaperlessTag[]>;
  connectionCountsByDocumentId?: Record<string, number>;
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
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {documents.map((document) => (
        <div
          className="relative flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-panel p-2 shadow-sm transition-colors hover:bg-panel-strong/40 data-[selected=true]:bg-panel-strong"
          data-document-row={document.id}
          data-selected={selectedIds.has(document.id)}
          key={document.id}
          onClick={() => handleClick(document.id)}
          onDoubleClick={() => handleDoubleClick(document.id)}
        >
          {selectedIds.has(document.id) ? (
            <input checked className="absolute left-3 top-3 z-10 size-4" readOnly type="checkbox" />
          ) : null}
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Thumbnail documentId={document.id} title={document.title} />
              {visible.has("tags") ? (
                <div className="absolute left-2 top-2 max-w-[calc(100%-1rem)]">
                  <DocumentTagChips max={2} tags={tagsByDocumentId[document.id] ?? []} />
                </div>
              ) : null}
            </div>
            <div>
              {visible.has("title") ? (
                <p className="truncate text-sm font-semibold" title={document.title}>
                  {document.title}
                </p>
              ) : null}
              <dl className="mt-2 grid gap-1 text-xs">
                {visible.has("documentType") ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">{tFilters("field_documentType")}</dt>
                    <dd className="truncate text-right">
                      {document.document_type_key ?? t("list.uncategorized")}
                    </dd>
                  </div>
                ) : null}
                {visible.has("correspondent") ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">{tFilters("field_correspondent")}</dt>
                    <dd className="truncate text-right">{document.correspondent_name ?? "—"}</dd>
                  </div>
                ) : null}
                {visible.has("connections") ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">{tFilters("field_connections")}</dt>
                    <dd>{connectionCountsByDocumentId[document.id] ?? 0}</dd>
                  </div>
                ) : null}
                {visible.has("pages") ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">{tFilters("field_pages")}</dt>
                    <dd>{document.page_count ?? "—"}</dd>
                  </div>
                ) : null}
                {visible.has("createdAt") ? (
                  <div className="grid gap-0.5">
                    <dt className="text-muted">{tFilters("field_createdAt")}</dt>
                    <dd>{new Date(document.created_at).toLocaleDateString()}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-1 flex items-center gap-1">
                <DocumentStatusBadge status={document.status} />
              </div>
            </div>
          </div>
          <DocumentRowActions documentId={document.id} detailHref={detailHref(document.id)} />
        </div>
      ))}
    </section>
  );
}
