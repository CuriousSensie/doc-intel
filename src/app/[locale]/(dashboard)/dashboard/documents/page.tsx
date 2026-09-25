import { randomUUID } from "node:crypto";

import { getLocale, getTranslations } from "next-intl/server";

import { Link, redirect } from "@/i18n/navigation";

import { DocumentsBulkList } from "@/components/documents/documents-bulk-list";
import { DocumentsFilterBar } from "@/components/documents/documents-filter-bar";
import { DocumentsPagination } from "@/components/documents/documents-pagination";
import { Button } from "@/components/ui/button";
import {
  getPaperlessContentSnippets,
  getPaperlessDocumentCustomFields,
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
import { isFeatureEnabled } from "@/config/features";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getMembership } from "@/modules/organizations/organizations.service";
import { listCustomFieldDefs } from "@/modules/custom-fields/custom-field-defs.service";
import { mapRawCustomFieldValues } from "@/modules/custom-fields/custom-field-values";
import {
  documentsViewSearchParamSchema,
  type DocumentListField,
  listDocumentsFilterSchema,
  parseDocumentListFields,
  parseDocumentsSearchParams
} from "@/modules/documents/documents.schemas";
import { countConnectionsForDocuments, listDocuments } from "@/modules/documents/documents.service";
import { getEntity } from "@/modules/entities/entities.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { getSavedView } from "@/modules/saved-views/saved-views.service";

export const dynamic = "force-dynamic";

function EmptyDocumentsState({ t }: { t: Awaited<ReturnType<typeof getTranslations>> }) {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="w-full rounded-lg border border-border bg-panel p-6 text-center shadow-sm">
        <h1 className="text-3xl font-black">{t("list.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t("list.notInOrganization")}</p>
        <Button variant="outline" asChild className="mt-6">
          <Link href="/organizations/new">{t("list.createOrganization")}</Link>
        </Button>
      </section>
    </div>
  );
}

function firstSearchValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export default async function DocumentsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  requireFeature("documents");
  const [context, rawSearch, t, locale] = await Promise.all([
    requireUser("/dashboard/documents"),
    searchParams,
    getTranslations("documents"),
    getLocale()
  ]);
  const organizationId = await getActiveOrganizationId(context.user.id);

  if (!organizationId) {
    return <EmptyDocumentsState t={t} />;
  }

  const defsCtx = {
    db: await createClient(),
    orgId: organizationId,
    actorId: context.user.id,
    correlationId: randomUUID()
  };
  const rawSavedViewId = firstSearchValue(rawSearch.savedViewId);
  const savedView =
    rawSavedViewId &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(rawSavedViewId)
      ? await getSavedView(defsCtx, rawSavedViewId).catch(() => null)
      : null;
  const savedSort = jsonObject(savedView?.sort);
  const savedColumns = jsonStringArray(savedView?.columns);
  const savedDocumentIds = jsonStringArray(savedView?.document_ids);
  const filter =
    savedView?.view_kind === "static"
      ? listDocumentsFilterSchema.parse({
          documentIds: savedDocumentIds,
          page: firstSearchValue(rawSearch.page),
          pageSize: firstSearchValue(rawSearch.pageSize),
          sort: savedSort.sort,
          sortDirection: savedSort.sortDirection
        })
      : savedView?.view_kind === "dynamic"
        ? listDocumentsFilterSchema.parse({
            ...jsonObject(savedView.filters),
            page: firstSearchValue(rawSearch.page),
            pageSize: firstSearchValue(rawSearch.pageSize),
            sort: savedSort.sort,
            sortDirection: savedSort.sortDirection
          })
        : parseDocumentsSearchParams(rawSearch);
  const rawView =
    savedView?.view_kind === "dynamic" && typeof savedSort.view === "string"
      ? savedSort.view
      : firstSearchValue(rawSearch.view);
  const viewParse = documentsViewSearchParamSchema.safeParse({ view: rawView });
  const foldersEnabled = isFeatureEnabled("folders");
  const view = viewParse.success ? (viewParse.data.view ?? "list") : "list";
  const savedFieldsParse = documentsViewSearchParamSchema.safeParse({ fields: savedColumns });
  const parsedVisibleFields =
    savedView?.view_kind === "dynamic" &&
    savedFieldsParse.success &&
    savedFieldsParse.data.fields?.length
      ? (savedFieldsParse.data.fields as DocumentListField[])
      : parseDocumentListFields(rawSearch);

  const client = await paperlessFor(organizationId);

  const [
    { items: documents, totalCount, page, pageSize, totalPages },
    tags,
    correspondents,
    documentTypes,
    customFieldDefs,
    selectedEntity,
    membership
  ] = await Promise.all([
    listDocuments(organizationId, filter),
    getCachedTags(client, organizationId),
    getCachedCorrespondents(client, organizationId),
    getCachedDocumentTypes(client, organizationId),
    listCustomFieldDefs(defsCtx),
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
      : Promise.resolve(null),
    getMembership(organizationId, context.user.id)
  ]);
  // Owners see every document, so "shared with you" only means something for other roles.
  const sharedDocumentIds =
    membership?.role === "owner"
      ? []
      : documents.filter((doc) => doc.created_by !== context.user.id).map((doc) => doc.id);
  const customFieldDefByKey = new Map(customFieldDefs.map((def) => [def.key, def]));
  const visibleFields = parsedVisibleFields.filter((field) => {
    if (!field.startsWith("custom:")) return true;
    const def = customFieldDefByKey.get(field.slice("custom:".length));
    return Boolean(def && def.data_type !== "documentlink");
  });

  if (documents.length === 0 && page > 1 && totalPages > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rawSearch)) {
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else if (value !== undefined) {
        params.set(key, value);
      }
    }
    params.set("page", String(totalPages));
    redirect({ href: `/dashboard/documents?${params.toString()}`, locale });
  }

  const needsTags = visibleFields.includes("tags") && documents.length > 0;
  const needsConnections = visibleFields.includes("connections") && documents.length > 0;
  const needsContent = view === "largeCards" && documents.length > 0;
  const visibleCustomFieldDefs = visibleFields
    .filter((field) => field.startsWith("custom:"))
    .map((field) => customFieldDefByKey.get(field.slice("custom:".length)))
    .filter((def): def is (typeof customFieldDefs)[number] => Boolean(def));
  const needsCustomFields = visibleCustomFieldDefs.length > 0 && documents.length > 0;
  const tagById = new Map(tags.map((tg) => [tg.id, tg]));

  const [
    contentByPaperlessId,
    tagsByPaperlessId,
    connectionCountsByDocumentId,
    customFieldsByPaperlessId
  ] = await Promise.all([
    needsContent
      ? getPaperlessContentSnippets(
          client,
          documents.map((d) => d.paperless_document_id)
        ).then((entries) => Object.fromEntries(entries))
      : Promise.resolve({} as Record<number, string>),
    needsTags
      ? getPaperlessDocumentTags(
          client,
          documents.map((d) => d.paperless_document_id)
        )
      : Promise.resolve(new Map<number, number[]>()),
    needsConnections
      ? countConnectionsForDocuments(
          organizationId,
          documents.map((d) => d.id)
        )
      : Promise.resolve({} as Record<string, number>),
    needsCustomFields
      ? getPaperlessDocumentCustomFields(
          client,
          documents.map((d) => d.paperless_document_id)
        )
      : Promise.resolve(new Map<number, Array<{ field: number; value: unknown }>>())
  ]);

  const tagsByDocumentId: Record<string, PaperlessTag[]> = Object.fromEntries(
    documents.map((d) => [
      d.id,
      (tagsByPaperlessId.get(d.paperless_document_id) ?? [])
        .map((tagId) => tagById.get(tagId))
        .filter((tag): tag is PaperlessTag => Boolean(tag))
    ])
  );
  const customFieldValuesByDocumentId = Object.fromEntries(
    documents.map((d) => [
      d.id,
      mapRawCustomFieldValues(
        customFieldsByPaperlessId.get(d.paperless_document_id),
        customFieldDefs
      )
    ])
  );

  // folderId isn't in the flat views' own filter UI (it arrives via a shared link or a document
  // dragged/moved into a folder from the explorer view) — folded into isFiltered so a stray
  // folderId still surfaces the "clear filters" escape hatch now that the rail (and its
  // breadcrumb, which used to cover this) is gone.
  const isFiltered = Boolean(
    filter.documentTypeKey ||
    filter.status ||
    filter.dateFrom ||
    filter.dateTo ||
    filter.q ||
    filter.tagIds?.length ||
    filter.correspondentId ||
    filter.entityId ||
    filter.hasNoConnections ||
    filter.createdBy ||
    filter.folderId !== undefined ||
    savedView
  );

  const documentsMain = (
    <div className="grid min-w-0 flex-1 gap-5">
      <DocumentsFilterBar
        current={{ ...filter, fields: visibleFields, view }}
        foldersEnabled={foldersEnabled}
        filterOptions={{
          tags,
          documentTypes: documentTypes.map((dt) => ({
            key: toDocumentTypeKey(dt.name),
            name: dt.name
          })),
          customFields: customFieldDefs.filter((def) => def.data_type !== "documentlink")
        }}
        key={JSON.stringify(rawSearch)}
        selectedEntity={
          selectedEntity ? { id: selectedEntity.id, label: selectedEntity.display_name } : null
        }
      />

      {isFiltered ? (
        <div className="flex min-w-0 items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
          <span>{t("list.filteredView", { count: totalCount })}</span>
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
            attributeOptions={{
              tags,
              correspondents,
              documentTypes,
              customFields: customFieldDefs.filter(
                (def) => def.data_type !== "documentlink" && def.paperless_custom_field_id !== null
              )
            }}
            connectionCountsByDocumentId={connectionCountsByDocumentId}
            contentByPaperlessId={contentByPaperlessId}
            customFieldDefs={visibleCustomFieldDefs}
            customFieldValuesByDocumentId={customFieldValuesByDocumentId}
            documents={documents}
            filter={filter}
            sharedDocumentIds={sharedDocumentIds}
            tagsByDocumentId={tagsByDocumentId}
            visibleFields={visibleFields}
            viewMode={view}
          />
          <DocumentsPagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            totalPages={totalPages}
          />
        </>
      )}
    </div>
  );

  return documentsMain;
}
