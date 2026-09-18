"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useRef } from "react";

import { DocumentRowActions } from "@/components/documents/document-row-actions";
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
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import { formatCustomFieldValue } from "@/modules/custom-fields/custom-field-values";
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
  customFieldDefs = [],
  customFieldValuesByDocumentId = {},
  visibleFields
}: {
  documents: Document[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  ctxQuery?: string;
  tagsByDocumentId?: Record<string, PaperlessTag[]>;
  connectionCountsByDocumentId?: Record<string, number>;
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
    <div className="min-w-0 overflow-x-auto">
      <Table className="min-w-[1260px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <span className="sr-only">{t("bulk.selectPage")}</span>
            </TableHead>
            {visible.has("title") ? (
              <TableHead className="w-80">{tFilters("field_title")}</TableHead>
            ) : null}
            {visible.has("tags") ? (
              <TableHead className="w-52">{tFilters("field_tags")}</TableHead>
            ) : null}
            {visible.has("correspondent") ? (
              <TableHead className="w-48">{tFilters("field_correspondent")}</TableHead>
            ) : null}
            {visible.has("documentType") ? (
              <TableHead className="w-44">{tFilters("field_documentType")}</TableHead>
            ) : null}
            {visible.has("connections") ? (
              <TableHead className="w-32">{tFilters("field_connections")}</TableHead>
            ) : null}
            {visible.has("pages") ? (
              <TableHead className="w-24">{tFilters("field_pages")}</TableHead>
            ) : null}
            {visible.has("createdAt") ? (
              <TableHead className="w-48">{tFilters("field_createdAt")}</TableHead>
            ) : null}
            {customFieldDefs.map((def) => (
              <TableHead className="w-48" key={def.id}>
                {def.label}
              </TableHead>
            ))}
            <TableHead className="w-36">
              <span className="sr-only">{t("detail.actions.open")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <TableRow
              className="cursor-pointer"
              data-document-row={document.id}
              data-state={selectedIds.has(document.id) ? "selected" : undefined}
              key={document.id}
              onClick={() => handleClick(document.id)}
              onDoubleClick={() => handleDoubleClick(document.id)}
            >
              <TableCell>
                {selectedIds.has(document.id) ? (
                  <input checked className="size-4" readOnly type="checkbox" />
                ) : (
                  <span className="block size-4" />
                )}
              </TableCell>
              {visible.has("title") ? (
                <TableCell className="w-80">
                  <p className="truncate font-semibold" title={document.title}>
                    {document.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">{document.mime_type ?? "—"}</p>
                </TableCell>
              ) : null}
              {visible.has("tags") ? (
                <TableCell className="w-52">
                  <DocumentTagChips max={3} tags={tagsByDocumentId[document.id] ?? []} />
                </TableCell>
              ) : null}
              {visible.has("correspondent") ? (
                <TableCell className="w-48 truncate text-muted">
                  {document.correspondent_name ?? "—"}
                </TableCell>
              ) : null}
              {visible.has("documentType") ? (
                <TableCell className="w-44 truncate text-muted">
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
                <TableCell className="w-48 text-muted">
                  {new Date(document.created_at).toLocaleString()}
                </TableCell>
              ) : null}
              {customFieldDefs.map((def) => (
                <TableCell className="w-48 truncate text-muted" key={def.id}>
                  {formatCustomFieldValue(def, customFieldValuesByDocumentId[document.id]?.[def.key])}
                </TableCell>
              ))}
              <TableCell className="w-36">
                <DocumentRowActions documentId={document.id} detailHref={detailHref(document.id)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
