"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import type { Document } from "@/modules/documents/documents.service";

// The original (and still default) row rendering — extracted out of documents-bulk-list.tsx so
// it can be swapped for the two card view modes without duplicating selection/bulk-action logic.
export function DocumentListView({
  documents,
  selectedIds,
  onToggle
}: {
  documents: Document[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("documents");

  return (
    <section className="grid gap-3">
      {documents.map((document) => (
        <div
          className="flex items-center gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm transition-colors hover:bg-panel-strong/40"
          data-document-row={document.id}
          key={document.id}
        >
          <input
            checked={selectedIds.has(document.id)}
            className="size-4 shrink-0"
            onChange={() => onToggle(document.id)}
            type="checkbox"
          />
          <Link
            className="flex flex-1 flex-col justify-between gap-3 sm:flex-row sm:items-center"
            href={`/dashboard/documents/${document.id}`}
          >
            <div>
              <p className="font-semibold">{document.title}</p>
              <p className="mt-1 text-xs text-muted">
                {document.document_type_key ?? t("list.uncategorized")}
                {document.correspondent_name ? ` · ${document.correspondent_name}` : ""}
                {document.page_count ? ` · ${t("list.pagesCount", { count: document.page_count })}` : ""}
                {" · "}
                {new Date(document.created_at).toLocaleString()}
              </p>
            </div>
            <DocumentStatusBadge status={document.status} />
          </Link>
        </div>
      ))}
    </section>
  );
}
