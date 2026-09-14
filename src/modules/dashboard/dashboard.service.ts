import { createClient } from "@/lib/supabase/server";

// specs/05-level-1-structure.md §Dashboard information architecture — Home content differs by
// role. Owner/admin get org health; member/read-only get a task-oriented view of their own
// recent activity. Kept as plain counts, not a generic "widget" abstraction — there's exactly
// one caller (the Home page) and a real second one hasn't shown up yet.

export type OwnerAdminSummary = {
  documentCountsByStatus: Record<string, number>;
  noConnectionsCount: number;
  entityCounts: Array<{ typeKey: string; typeName: string; count: number }>;
  pendingInvitesCount: number;
  provisioningStatus: string;
};

export async function getOwnerAdminSummary(organizationId: string): Promise<OwnerAdminSummary> {
  const db = await createClient();

  const [documentsResult, connectionsResult, entitiesResult, entityTypesResult, invitesResult, orgResult] =
    await Promise.all([
      db
        .from("documents")
        .select("status")
        .eq("organization_id", organizationId)
        .is("deleted_at", null),
      db
        .from("connections")
        .select("source_kind, source_id, target_kind, target_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null),
      db
        .from("entities")
        .select("entity_type_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null),
      db.from("entity_types").select("id, key, name").eq("organization_id", organizationId),
      db
        .from("organization_invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .is("revoked_at", null),
      db.from("organizations").select("provisioning_status").eq("id", organizationId).maybeSingle()
    ]);

  if (documentsResult.error) throw documentsResult.error;
  if (connectionsResult.error) throw connectionsResult.error;
  if (entitiesResult.error) throw entitiesResult.error;
  if (entityTypesResult.error) throw entityTypesResult.error;
  if (invitesResult.error) throw invitesResult.error;
  if (orgResult.error) throw orgResult.error;

  const documentCountsByStatus: Record<string, number> = {};
  for (const row of documentsResult.data ?? []) {
    documentCountsByStatus[row.status] = (documentCountsByStatus[row.status] ?? 0) + 1;
  }

  const connectedDocumentIds = new Set<string>();
  for (const row of connectionsResult.data ?? []) {
    if (row.source_kind === "document") connectedDocumentIds.add(row.source_id);
    if (row.target_kind === "document") connectedDocumentIds.add(row.target_id);
  }
  const totalDocuments = documentsResult.data?.length ?? 0;
  const noConnectionsCount = totalDocuments - connectedDocumentIds.size;

  const entityCountByType = new Map<string, number>();
  for (const row of entitiesResult.data ?? []) {
    entityCountByType.set(row.entity_type_id, (entityCountByType.get(row.entity_type_id) ?? 0) + 1);
  }
  const entityCounts = (entityTypesResult.data ?? []).map((type) => ({
    typeKey: type.key,
    typeName: type.name,
    count: entityCountByType.get(type.id) ?? 0
  }));

  return {
    documentCountsByStatus,
    noConnectionsCount: Math.max(noConnectionsCount, 0),
    entityCounts,
    pendingInvitesCount: invitesResult.count ?? 0,
    provisioningStatus: orgResult.data?.provisioning_status ?? "ready"
  };
}

export type MemberSummary = {
  recentUploads: Array<{ id: string; filename: string; status: string; created_at: string }>;
  attentionDocuments: Array<{ id: string; title: string; status: string }>;
};

const ATTENTION_STATUSES = ["failed", "orphaned"] as const;

export async function getMemberSummary(organizationId: string): Promise<MemberSummary> {
  const db = await createClient();

  const [uploadsResult, attentionResult] = await Promise.all([
    db
      .from("document_uploads")
      .select("id, filename, status, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("documents")
      .select("id, title, status")
      .eq("organization_id", organizationId)
      .in("status", ATTENTION_STATUSES)
      .is("deleted_at", null)
      .limit(10)
  ]);

  if (uploadsResult.error) throw uploadsResult.error;
  if (attentionResult.error) throw attentionResult.error;

  return {
    recentUploads: uploadsResult.data ?? [],
    attentionDocuments: attentionResult.data ?? []
  };
}
