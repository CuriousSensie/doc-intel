import { randomUUID } from "node:crypto";

import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { DocumentProcessingRefresh } from "@/components/documents/document-processing-refresh";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { DocumentsBulkList } from "@/components/documents/documents-bulk-list";
import { DocumentsFilterBar } from "@/components/documents/documents-filter-bar";
import { DocumentsPagination } from "@/components/documents/documents-pagination";
import { Button } from "@/components/ui/button";
import { documentsConfig } from "@/config/documents";
import { getPaperlessContentSnippets, toDocumentTypeKey } from "@/lib/paperless/documents";
import { paperlessFor } from "@/lib/paperless/client";
import {
  getCachedCorrespondents,
  getCachedDocumentTypes,
  getCachedTags
} from "@/lib/paperless/metadata-cache";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import {
  documentsViewSearchParamSchema,
  parseDocumentsSearchParams
} from "@/modules/documents/documents.schemas";
import { listDocuments, listRecentUploads } from "@/modules/documents/documents.service";
import { getEntity } from "@/modules/entities/entities.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EmptyDocumentsState({ t }: { t: Awaited<ReturnType<typeof getTranslations>> }) {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="w-full rounded-lg border border-border bg-panel p-6 text-center shadow-sm">
        <h1 className="text-3xl font-black">{t("list.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t("list.notInOrganization")}</p>
        <Button asChild className="mt-6">
          <Link href="/organizations/new">{t("list.createOrganization")}</Link>
        </Button>
      </section>
    </div>
  );
}

export default async function DocumentsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  requireFeature("documents");
  const [context, rawSearch, t] = await Promise.all([
    requireUser("/dashboard/documents"),
    searchParams,
    getTranslations("documents")
  ]);
  const organizationId = await getActiveOrganizationId(context.user.id);

  if (!organizationId) {
    return <EmptyDocumentsState t={t} />;
  }

  const filter = parseDocumentsSearchParams(rawSearch);
  const rawView = Array.isArray(rawSearch.view) ? rawSearch.view[0] : rawSearch.view;
  const viewParse = documentsViewSearchParamSchema.safeParse({ view: rawView });
  const view = (viewParse.success ? viewParse.data.view : undefined) ?? "list";

  const client = await paperlessFor(organizationId);

  const [{ items: documents, nextCursor }, uploads, tags, correspondents, documentTypes, selectedEntity] =
    await Promise.all([
      listDocuments(organizationId, filter),
      listRecentUploads(organizationId),
      getCachedTags(client, organizationId),
      getCachedCorrespondents(client, organizationId),
      getCachedDocumentTypes(client, organizationId),
      filter.entityId
        ? getEntity(
            { db: await createClient(), orgId: organizationId, actorId: context.user.id, correlationId: randomUUID() },
            filter.entityId
          ).catch(() => null)
        : Promise.resolve(null)
    ]);

  // Large Cards view only: one extra page-scoped Paperless call for `content` — never mirrored,
  // never cached (see getPaperlessContentSnippets's own comment).
  const contentByPaperlessId =
    view === "largeCards" && documents.length > 0
      ? Object.fromEntries(
          await getPaperlessContentSnippets(
            client,
            documents.map((d) => d.paperless_document_id)
          )
        )
      : {};

  const isFiltered = Boolean(
    filter.documentTypeKey ||
      filter.status ||
      filter.dateFrom ||
      filter.dateTo ||
      filter.q ||
      filter.tagIds?.length ||
      filter.correspondentId ||
      filter.entityId ||
      filter.hasNoConnections
  );

  // Only surface uploads that haven't (yet, or ever) landed in `documents` — an upload that
  // completed successfully is already represented by its own row in the list below.
  const inFlightUploads = uploads.filter((upload) => upload.status !== "completed");

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">{t("list.title")}</h1>
        <p className="mt-1 text-sm text-muted">
          {t("list.maxSizePerFile", { size: formatSize(documentsConfig.maxSizeBytes) })}
        </p>
        <div className="mt-6">
          <DocumentUploadForm />
        </div>
      </section>

      {inFlightUploads.length > 0 ? (
        <section className="grid gap-3">
          <DocumentProcessingRefresh active />
          <h2 className="text-sm font-semibold text-muted">{t("list.processing")}</h2>
          {inFlightUploads.map((upload) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm sm:flex-row sm:items-center"
              key={upload.id}
            >
              <div>
                <p className="font-semibold">{upload.filename}</p>
                <p className="mt-1 text-xs text-muted">
                  {formatSize(upload.size_bytes)} &middot;{" "}
                  {new Date(upload.created_at).toLocaleString()}
                  {upload.error_message ? ` — ${upload.error_message}` : ""}
                </p>
              </div>
              <DocumentStatusBadge status={upload.status} />
            </div>
          ))}
        </section>
      ) : null}

      <DocumentsFilterBar
        current={{ ...filter, view }}
        filterOptions={{
          tags,
          correspondents,
          documentTypes: documentTypes.map((dt) => ({ key: toDocumentTypeKey(dt.name), name: dt.name }))
        }}
        key={JSON.stringify(rawSearch)}
        selectedEntity={selectedEntity ? { id: selectedEntity.id, label: selectedEntity.display_name } : null}
      />

      {isFiltered ? (
        <div className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
          <span>{t("list.filteredView", { count: documents.length })}</span>
          <Link className="underline underline-offset-4" href="/dashboard/documents">
            {t("list.clearFilters")}
          </Link>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <p className="rounded-lg border border-border bg-panel p-6 text-muted">
          {isFiltered ? t("list.emptyFiltered") : t("list.emptyUnfiltered")}
        </p>
      ) : (
        <>
          <DocumentsBulkList
            contentByPaperlessId={contentByPaperlessId}
            documents={documents}
            filter={filter}
            viewMode={view}
          />
          <DocumentsPagination hasCursor={Boolean(filter.cursor)} nextCursor={nextCursor} />
        </>
      )}
    </div>
  );
}
