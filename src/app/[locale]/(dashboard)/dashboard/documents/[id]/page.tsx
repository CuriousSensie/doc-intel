import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { DocumentContentTab } from "@/components/documents/document-content-tab";
import { DocumentDetailShell } from "@/components/documents/document-detail-shell";
import { DocumentHistoryTab } from "@/components/documents/document-history-tab";
import { NotFoundError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import { getCachedDocumentTypes, getCachedTags } from "@/lib/paperless/metadata-cache";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listCustomFieldDefs } from "@/modules/custom-fields/custom-field-defs.service";
import { listDocumentsFilterSchema } from "@/modules/documents/documents.schemas";
import { loadDocumentPermissions } from "@/modules/documents/document-shares.service";
import {
  getAdjacentDocumentId,
  getDocument,
  getDocumentAccess
} from "@/modules/documents/documents.service";

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ctx?: string }>;
}) {
  requireFeature("documents");
  // Only `params` and auth are needed up front — getDocument() no longer needs a pre-resolved
  // active org (see its own doc comment): one fewer sequential round trip before the document
  // itself even starts loading.
  const [{ id }, search, context] = await Promise.all([
    params,
    searchParams,
    requireUser("/dashboard/documents")
  ]);

  // Permissions tab data: started now, never awaited here (loadDocumentPermissions can't reject),
  // so it runs in parallel with the document fetch below and streams into the tab.
  const permissions = loadDocumentPermissions(id);

  // specs/03-api.md: cross-tenant access is 404, never 403 — getDocument()'s own RLS-scoped
  // query already returns this as "not found" rather than a distinguishable denial.
  let document: Awaited<ReturnType<typeof getDocument>>;
  try {
    document = await getDocument(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // The list page appends its current filter+sort as `ctx` on every row link (see
  // documents-bulk-list.tsx) so next/prev navigation here stays scoped to that exact view.
  // Missing/malformed ctx just falls back to the unfiltered default (created desc).
  let filter: ReturnType<typeof listDocumentsFilterSchema.parse> = {};
  if (search.ctx) {
    try {
      const candidate = JSON.parse(decodeURIComponent(search.ctx));
      const parsed = listDocumentsFilterSchema.safeParse(candidate);
      if (parsed.success) filter = parsed.data;
    } catch {
      // malformed ctx — ignore, fall back to the default filter
    }
  }
  const ctxQuery = search.ctx ? `?ctx=${encodeURIComponent(search.ctx)}` : "";

  const client = await paperlessFor(document.organization_id);

  const defsCtx = {
    db: await createClient(),
    orgId: document.organization_id,
    actorId: context.user.id,
    correlationId: randomUUID()
  };
  const [tags, documentTypes, customFieldDefs, previousId, nextId, access] = await Promise.all([
    getCachedTags(client, document.organization_id),
    getCachedDocumentTypes(client, document.organization_id),
    listCustomFieldDefs(defsCtx),
    getAdjacentDocumentId(document.organization_id, document, filter, "previous"),
    getAdjacentDocumentId(document.organization_id, document, filter, "next"),
    getDocumentAccess(document, context.user.id)
  ]);

  return (
    <div className="mx-auto grid w-full max-w-[1800px] gap-4 px-1">
      <DocumentDetailShell
        canEdit={access.canEdit}
        canManage={access.canManage}
        contentTab={<DocumentContentTab document={document} />}
        ctxQuery={ctxQuery}
        customFieldDefs={customFieldDefs}
        filterOptions={{ tags, documentTypes }}
        historyTab={<DocumentHistoryTab history={document.history} />}
        initialDocument={document}
        nextId={nextId}
        permissions={permissions}
        previousId={previousId}
      />
    </div>
  );
}
