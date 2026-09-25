import { paperlessFor } from "@/lib/paperless/client";
import { getCachedDocumentTypes, getCachedTags } from "@/lib/paperless/metadata-cache";
import { createClient } from "@/lib/supabase/server";

// specs/05-level-1-structure.md §Dashboard information architecture — Home content differs by
// role. Owner gets org-wide stats plus a per-member breakdown; member (read-only or not) gets
// their own stats plus a reduced org-wide set. Counts come from SQL (get_org_dashboard_counts /
// get_member_dashboard_counts, supabase/migrations/20260921000000_dashboard_stats_rpc.sql)
// instead of pulling full rows into JS — see that migration's header for why. Tags/
// document types live only in Paperless, which has no per-user creator
// attribution, so they're org-wide only and never appear in getMemberStats().

export type OrgStats = {
  documents: number;
  tags: number;
  documentTypes: number;
};

export type MemberStats = {
  documents: number;
};

export async function getOrgStats(organizationId: string): Promise<OrgStats> {
  const db = await createClient();
  const client = await paperlessFor(organizationId);

  const [countsResult, tags, documentTypes] = await Promise.all([
    db.rpc("get_org_dashboard_counts", { p_organization_id: organizationId }),
    getCachedTags(client, organizationId),
    getCachedDocumentTypes(client, organizationId)
  ]);

  if (countsResult.error) throw countsResult.error;

  const counts = countsResult.data?.[0];

  return {
    documents: Number(counts?.documents ?? 0),
    tags: tags.length,
    documentTypes: documentTypes.length
  };
}

export async function getMemberStats(
  organizationId: string,
  userId: string
): Promise<MemberStats> {
  const db = await createClient();
  const { data, error } = await db.rpc("get_member_dashboard_counts", {
    p_organization_id: organizationId,
    p_user_id: userId
  });

  if (error) throw error;

  const counts = data?.[0];

  return {
    documents: Number(counts?.documents ?? 0)
  };
}

export async function getPendingInvitesCount(organizationId: string): Promise<number> {
  const db = await createClient();
  const { count, error } = await db
    .from("organization_invitations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .is("revoked_at", null);

  if (error) throw error;
  return count ?? 0;
}

export async function getProvisioningStatus(organizationId: string): Promise<string> {
  const db = await createClient();
  const { data, error } = await db
    .from("organizations")
    .select("provisioning_status")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) throw error;
  return data?.provisioning_status ?? "ready";
}

export type AttentionDocument = { id: string; title: string; status: string };

const ATTENTION_STATUSES = ["failed", "orphaned"] as const;

export async function getAttentionDocuments(organizationId: string): Promise<AttentionDocument[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("documents")
    .select("id, title, status")
    .eq("organization_id", organizationId)
    .in("status", ATTENTION_STATUSES)
    .is("deleted_at", null)
    .limit(10);

  if (error) throw error;
  return data ?? [];
}

export type RecentUpload = { id: string; filename: string; status: string; created_at: string };

export async function getRecentUploads(organizationId: string): Promise<RecentUpload[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("document_uploads")
    .select("id, filename, status, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw error;
  return data ?? [];
}
