"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useState } from "react";

import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentTagChips } from "@/components/documents/document-tag-chips";
import type { PaperlessTag } from "@/lib/paperless/documents";
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
  tagsByDocumentId = {}
}: {
  documents: Document[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  ctxQuery?: string;
  tagsByDocumentId?: Record<string, PaperlessTag[]>;
}) {
  const t = useTranslations("documents");

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {documents.map((document) => (
        <div
          className="relative flex flex-col gap-2 rounded-lg border border-border bg-panel p-2 shadow-sm transition-colors hover:bg-panel-strong/40"
          data-document-row={document.id}
          key={document.id}
        >
          <input
            checked={selectedIds.has(document.id)}
            className="absolute left-3 top-3 z-10 size-4"
            onChange={() => onToggle(document.id)}
            type="checkbox"
          />
          <Link className="flex flex-col gap-2" href={`/dashboard/documents/${document.id}${ctxQuery}`}>
            <Thumbnail documentId={document.id} title={document.title} />
            <div>
              <p className="truncate text-sm font-semibold" title={document.title}>
                {document.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {document.document_type_key ?? t("list.uncategorized")}
                {document.correspondent_name ? ` · ${document.correspondent_name}` : ""}
              </p>
              <div className="mt-1 flex items-center gap-1">
                <DocumentStatusBadge status={document.status} />
              </div>
              <div className="mt-1">
                <DocumentTagChips max={2} tags={tagsByDocumentId[document.id] ?? []} />
              </div>
            </div>
          </Link>
        </div>
      ))}
    </section>
  );
}
