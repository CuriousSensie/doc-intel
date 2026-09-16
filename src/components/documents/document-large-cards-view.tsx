"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useState } from "react";

import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import type { Document } from "@/modules/documents/documents.service";

function Thumbnail({ documentId, title }: { documentId: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-32 w-24 shrink-0 items-center justify-center rounded-md bg-panel-strong">
        <FileText aria-hidden="true" className="size-8 text-muted" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy route, not a static asset.
    <img
      alt={title}
      className="h-32 w-24 shrink-0 rounded-md border border-border object-cover"
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
  contentByPaperlessId
}: {
  documents: Document[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  contentByPaperlessId: Record<number, string>;
}) {
  const t = useTranslations("documents");

  return (
    <section className="grid gap-3">
      {documents.map((document) => {
        const content = contentByPaperlessId[document.paperless_document_id];
        const snippet = content
          ? content.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 4).join(" ")
          : null;

        return (
          <div
            className="flex gap-3 rounded-lg border border-border bg-panel p-3 shadow-sm transition-colors hover:bg-panel-strong/40"
            data-document-row={document.id}
            key={document.id}
          >
            <input
              checked={selectedIds.has(document.id)}
              className="mt-1 size-4 shrink-0"
              onChange={() => onToggle(document.id)}
              type="checkbox"
            />
            <Thumbnail documentId={document.id} title={document.title} />
            <Link className="flex flex-1 flex-col gap-1 overflow-hidden" href={`/dashboard/documents/${document.id}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{document.title}</p>
                <DocumentStatusBadge status={document.status} />
              </div>
              <p className="text-xs text-muted">
                {document.document_type_key ?? t("list.uncategorized")}
                {document.correspondent_name ? ` · ${document.correspondent_name}` : ""}
                {document.page_count ? ` · ${t("list.pagesCount", { count: document.page_count })}` : ""}
                {" · "}
                {new Date(document.created_at).toLocaleString()}
              </p>
              {snippet ? <p className="mt-1 line-clamp-3 text-sm text-muted">{snippet}</p> : null}
            </Link>
          </div>
        );
      })}
    </section>
  );
}
