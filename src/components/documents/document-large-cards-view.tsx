"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useState } from "react";

import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentTagChips } from "@/components/documents/document-tag-chips";
import type { PaperlessTag } from "@/lib/paperless/documents";
import type { DocumentListField } from "@/modules/documents/documents.schemas";
import type { Document } from "@/modules/documents/documents.service";

function Thumbnail({ documentId, title }: { documentId: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-56 w-40 shrink-0 items-center justify-center rounded-md bg-panel-strong">
        <FileText aria-hidden="true" className="size-8 text-muted" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy route, not a static asset.
    <img
      alt={title}
      className="h-56 w-40 shrink-0 rounded-md border border-border object-cover"
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
  onToggle,
  contentByPaperlessId,
  ctxQuery = "",
  tagsByDocumentId = {},
  connectionCountsByDocumentId = {},
  visibleFields
}: {
  documents: Document[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  contentByPaperlessId: Record<number, string>;
  ctxQuery?: string;
  tagsByDocumentId?: Record<string, PaperlessTag[]>;
  connectionCountsByDocumentId?: Record<string, number>;
  visibleFields: DocumentListField[];
}) {
  const t = useTranslations("documents");
  const tFilters = useTranslations("documents.filters");
  const visible = new Set(visibleFields);

  return (
    <section className="grid gap-3">
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
            className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3 shadow-sm transition-colors hover:bg-panel-strong/40 md:flex-row"
            data-document-row={document.id}
            key={document.id}
          >
            <input
              checked={selectedIds.has(document.id)}
              className="mt-1 size-4 shrink-0"
              onChange={() => onToggle(document.id)}
              type="checkbox"
            />
            <div className="relative w-full shrink-0 md:w-40">
              <Thumbnail documentId={document.id} title={document.title} />
              {visible.has("tags") ? (
                <div className="absolute left-2 top-2 max-w-[calc(100%-1rem)]">
                  <DocumentTagChips max={3} tags={tagsByDocumentId[document.id] ?? []} />
                </div>
              ) : null}
            </div>
            <Link
              className="flex flex-1 flex-col gap-1 overflow-hidden"
              href={`/dashboard/documents/${document.id}${ctxQuery}`}
            >
              <div className="flex items-start justify-between gap-3">
                {visible.has("title") ? (
                  <p className="text-lg font-semibold">{document.title}</p>
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
                    <dd className="mt-0.5">
                      {document.document_type_key ?? t("list.uncategorized")}
                    </dd>
                  </div>
                ) : null}
                {visible.has("correspondent") ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {tFilters("field_correspondent")}
                    </dt>
                    <dd className="mt-0.5">{document.correspondent_name ?? "—"}</dd>
                  </div>
                ) : null}
                {visible.has("connections") ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {tFilters("field_connections")}
                    </dt>
                    <dd className="mt-0.5">{connectionCountsByDocumentId[document.id] ?? 0}</dd>
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
              </dl>
              {snippet ? <p className="mt-1 line-clamp-3 text-sm text-muted">{snippet}</p> : null}
            </Link>
          </div>
        );
      })}
    </section>
  );
}
