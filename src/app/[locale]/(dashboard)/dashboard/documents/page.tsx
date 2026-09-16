import { randomUUID } from "node:crypto";

import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { DocumentsBulkList } from "@/components/documents/documents-bulk-list";
import { DocumentsFilterBar } from "@/components/documents/documents-filter-bar";
import { DocumentsPagination } from "@/components/documents/documents-pagination";
import { Button } from "@/components/ui/button";
import {
  getPaperlessContentSnippets,
  getPaperlessDocumentTags,
  toDocumentTypeKey,
  type PaperlessTag
} from "@/lib/paperless/documents";
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
  parseDocumentListFields,
  parseDocumentsSearchParams
} from "@/modules/documents/documents.schemas";
import { countConnectionsForDocuments, listDocuments } from "@/modules/documents/documents.service";
import { getEntity } from "@/modules/entities/entities.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

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
  const visibleFields = parseDocumentListFields(rawSearch);

  const client = await paperlessFor(organizationId);

  const [{ items: documents, nextCursor }, tags, correspondents, documentTypes, selectedEntity] =
    await Promise.all([
      listDocuments(organizationId, filter),
      getCachedTags(client, organizationId),
      getCachedCorrespondents(client, organizationId),
      getCachedDocumentTypes(client, organizationId),
      filter.entityId
        ? getEntity(
            {
              db: await createClient(),
              orgId: organizationId,
              actorId: context.user.id,
              correlationId: randomUUID()
            },
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

  // Every view mode: page-scoped tag ids -> resolved {name,color,text_color}, for the per-row/
  // card colored tag chips. Tags aren't mirrored, so this is always a live call, same
  // id__in-scoped pattern as the content snippets above.
  const tagById = new Map(tags.map((tg) => [tg.id, tg]));
  const tagsByPaperlessId =
    documents.length > 0
      ? await getPaperlessDocumentTags(
          client,
          documents.map((d) => d.paperless_document_id)
        )
      : new Map<number, number[]>();
  const tagsByDocumentId: Record<string, PaperlessTag[]> = Object.fromEntries(
    documents.map((d) => [
      d.id,
      (tagsByPaperlessId.get(d.paperless_document_id) ?? [])
        .map((tagId) => tagById.get(tagId))
        .filter((tag): tag is PaperlessTag => Boolean(tag))
    ])
  );
  const connectionCountsByDocumentId = await countConnectionsForDocuments(
    organizationId,
    documents.map((d) => d.id)
  );

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

  return (
    <div className="grid gap-5">
      <DocumentsFilterBar
        current={{ ...filter, fields: visibleFields, view }}
        filterOptions={{
          tags,
          correspondents,
          documentTypes: documentTypes.map((dt) => ({
            key: toDocumentTypeKey(dt.name),
            name: dt.name
          }))
        }}
        key={JSON.stringify(rawSearch)}
        selectedEntity={
          selectedEntity ? { id: selectedEntity.id, label: selectedEntity.display_name } : null
        }
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
            connectionCountsByDocumentId={connectionCountsByDocumentId}
            contentByPaperlessId={contentByPaperlessId}
            documents={documents}
            filter={filter}
            tagsByDocumentId={tagsByDocumentId}
            visibleFields={visibleFields}
            viewMode={view}
          />
          <DocumentsPagination hasCursor={Boolean(filter.cursor)} nextCursor={nextCursor} />
        </>
      )}
    </div>
  );
}
