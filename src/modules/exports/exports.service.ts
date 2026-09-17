import type { ServiceContext } from "@/lib/service-context";
import type { Document } from "@/modules/documents/documents.service";

export type ExportRow = {
  documentId: string;
  title: string;
  documentTypeKey: string | null;
  documentDate: string | null;
  correspondentName: string | null;
  status: string;
  // Dynamic — one key per entity type connected to any document in this export (specs/05:
  // "a Customer column resolving through connections... is what makes the export worth
  // having"). Multiple connected entities of the same type join with "; ".
  entityColumns: Record<string, string>;
};

export type ResolvedExportData = {
  rows: ExportRow[];
  entityTypeColumns: Array<{ key: string; label: string }>;
};

// Batched, not per-document (N+1 would be the same mistake documents.service.ts's getDocument
// comment already fixed once) — one connections query per direction, one entities query, one
// entity_types query, regardless of how many documents are being exported.
export async function resolveExportData(
  ctx: ServiceContext,
  documentIds: string[]
): Promise<ResolvedExportData> {
  if (documentIds.length === 0) return { rows: [], entityTypeColumns: [] };

  const { data: documents, error: docsError } = await ctx.db
    .from("documents")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .in("id", documentIds);
  if (docsError) throw docsError;

  const [asSource, asTarget] = await Promise.all([
    ctx.db
      .from("connections")
      .select("source_id, target_kind, target_id")
      .eq("organization_id", ctx.orgId)
      .eq("source_kind", "document")
      .in("source_id", documentIds)
      .is("deleted_at", null),
    ctx.db
      .from("connections")
      .select("target_id, source_kind, source_id")
      .eq("organization_id", ctx.orgId)
      .eq("target_kind", "document")
      .in("target_id", documentIds)
      .is("deleted_at", null)
  ]);
  if (asSource.error) throw asSource.error;
  if (asTarget.error) throw asTarget.error;

  // documentId -> connected entity id[]
  const documentEntityIds = new Map<string, string[]>();
  const addLink = (documentId: string, kind: string, id: string) => {
    if (kind !== "entity") return;
    const existing = documentEntityIds.get(documentId) ?? [];
    existing.push(id);
    documentEntityIds.set(documentId, existing);
  };
  for (const row of asSource.data ?? []) addLink(row.source_id, row.target_kind, row.target_id);
  for (const row of asTarget.data ?? []) addLink(row.target_id, row.source_kind, row.source_id);

  const entityIds = [...new Set([...documentEntityIds.values()].flat())];

  const { data: entities, error: entitiesError } =
    entityIds.length > 0
      ? await ctx.db
          .from("entities")
          .select("id, display_name, entity_type_id, deleted_at")
          .eq("organization_id", ctx.orgId)
          .in("id", entityIds)
      : { data: [] as { id: string; display_name: string; entity_type_id: string; deleted_at: string | null }[], error: null };
  if (entitiesError) throw entitiesError;

  const entityTypeIds = [...new Set((entities ?? []).map((e) => e.entity_type_id))];
  const { data: entityTypes, error: entityTypesError } =
    entityTypeIds.length > 0
      ? await ctx.db.from("entity_types").select("id, key, name").in("id", entityTypeIds)
      : { data: [] as { id: string; key: string; name: string }[], error: null };
  if (entityTypesError) throw entityTypesError;

  const entityById = new Map((entities ?? []).map((e) => [e.id, e]));
  const entityTypeById = new Map((entityTypes ?? []).map((t) => [t.id, t]));
  const usedEntityTypeKeys = new Map<string, string>(); // key -> label

  const rows: ExportRow[] = (documents ?? []).map((doc: Document) => {
    const entityColumns: Record<string, string> = {};
    const connectedIds = documentEntityIds.get(doc.id) ?? [];

    const byType = new Map<string, string[]>();
    for (const id of connectedIds) {
      const entity = entityById.get(id);
      if (!entity || entity.deleted_at) continue;
      const entityType = entityTypeById.get(entity.entity_type_id);
      if (!entityType) continue;
      const names = byType.get(entityType.key) ?? [];
      names.push(entity.display_name);
      byType.set(entityType.key, names);
      usedEntityTypeKeys.set(entityType.key, entityType.name);
    }
    for (const [key, names] of byType) entityColumns[key] = names.join("; ");

    return {
      documentId: doc.id,
      title: doc.title,
      documentTypeKey: doc.document_type_key,
      documentDate: doc.document_date,
      correspondentName: doc.correspondent_name,
      status: doc.status,
      entityColumns
    };
  });

  const entityTypeColumns = [...usedEntityTypeKeys.entries()].map(([key, label]) => ({
    key,
    label
  }));

  return { rows, entityTypeColumns };
}
