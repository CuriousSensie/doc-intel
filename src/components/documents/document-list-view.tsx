"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { DocumentTagChips } from "@/components/documents/document-tag-chips";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { PaperlessTag } from "@/lib/paperless/documents";
import type { DocumentListField } from "@/modules/documents/documents.schemas";
import type { Document } from "@/modules/documents/documents.service";

// The original (and still default) row rendering — extracted out of documents-bulk-list.tsx so
// it can be swapped for the two card view modes without duplicating selection/bulk-action logic.
export function DocumentListView({
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
  const visible = new Set(visibleFields);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <span className="sr-only">{t("bulk.selectPage")}</span>
          </TableHead>
          {visible.has("title") ? <TableHead>{tFilters("field_title")}</TableHead> : null}
          {visible.has("tags") ? <TableHead>{tFilters("field_tags")}</TableHead> : null}
          {visible.has("correspondent") ? (
            <TableHead>{tFilters("field_correspondent")}</TableHead>
          ) : null}
          {visible.has("documentType") ? (
            <TableHead>{tFilters("field_documentType")}</TableHead>
          ) : null}
          {visible.has("connections") ? (
            <TableHead>{tFilters("field_connections")}</TableHead>
          ) : null}
          {visible.has("pages") ? <TableHead>{tFilters("field_pages")}</TableHead> : null}
          {visible.has("createdAt") ? <TableHead>{tFilters("field_createdAt")}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((document) => (
          <TableRow data-document-row={document.id} key={document.id}>
            <TableCell>
              <input
                checked={selectedIds.has(document.id)}
                className="size-4"
                onChange={() => onToggle(document.id)}
                type="checkbox"
              />
            </TableCell>
            {visible.has("title") ? (
              <TableCell className="min-w-72">
                <Link
                  className="font-semibold underline-offset-4 hover:underline"
                  href={`/dashboard/documents/${document.id}${ctxQuery}`}
                >
                  {document.title}
                </Link>
                <p className="mt-1 text-xs text-muted">{document.mime_type ?? "—"}</p>
              </TableCell>
            ) : null}
            {visible.has("tags") ? (
              <TableCell className="min-w-44">
                <DocumentTagChips max={3} tags={tagsByDocumentId[document.id] ?? []} />
              </TableCell>
            ) : null}
            {visible.has("correspondent") ? (
              <TableCell className="min-w-44 text-muted">
                {document.correspondent_name ?? "—"}
              </TableCell>
            ) : null}
            {visible.has("documentType") ? (
              <TableCell className="min-w-36 text-muted">
                {document.document_type_key ?? t("list.uncategorized")}
              </TableCell>
            ) : null}
            {visible.has("connections") ? (
              <TableCell className="text-muted">
                {connectionCountsByDocumentId[document.id] ?? 0}
              </TableCell>
            ) : null}
            {visible.has("pages") ? (
              <TableCell className="text-muted">{document.page_count ?? "—"}</TableCell>
            ) : null}
            {visible.has("createdAt") ? (
              <TableCell className="min-w-44 text-muted">
                {new Date(document.created_at).toLocaleString()}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
