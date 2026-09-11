import { ConflictError, NotFoundError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

export type OrganizationRecord = Database["public"]["Tables"]["organizations"]["Row"];

const DEFAULT_PAGE_SIZE = 20;

export async function listOrganizationsAdmin(
  options: { cursor?: string | null; limit?: number; search?: string } = {}
): Promise<{ items: OrganizationRecord[]; nextCursor: string | null }> {
  const admin = createAdminClient();
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCursor(options.cursor);

  let query = admin
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (options.search) {
    query = query.ilike("name", `%${options.search}%`);
  }

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null
  };
}

export async function suspendOrganization(actorId: string, organizationId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ suspended_at: new Date().toISOString() })
    .eq("id", organizationId);

  if (error) {
    throw error;
  }

  await logEvent({
    actorId,
    action: "admin.organization.suspended",
    entityType: "organization",
    entityId: organizationId,
    organizationId
  });
}

export async function unsuspendOrganization(
  actorId: string,
  organizationId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ suspended_at: null })
    .eq("id", organizationId);

  if (error) {
    throw error;
  }

  await logEvent({
    actorId,
    action: "admin.organization.unsuspended",
    entityType: "organization",
    entityId: organizationId,
    organizationId
  });
}

export async function deleteOrganizationAdmin(
  actorId: string,
  organizationId: string,
  metadata: Json = {}
): Promise<void> {
  // Logged before the delete, not after: audit_logs.organization_id is a real FK, and it would
  // fail to insert once the referenced organization no longer exists (it survives via
  // "on delete set null" only for rows that already existed at delete time).
  await logEvent({
    actorId,
    action: "organization.deleted",
    entityType: "organization",
    entityId: organizationId,
    organizationId,
    metadata
  });

  const admin = createAdminClient();
  const { error } = await admin.from("organizations").delete().eq("id", organizationId);

  if (error) {
    throw error;
  }
}

// specs/01-architecture.md §Provisioning: "repairs a failed org" — only eligible when
// pending/provisioning_failed, matching claim_provisioning()'s own claimable states. A
// 'ready' or already-'provisioning' org gets a clear rejection here rather than silently
// enqueueing a job that claim_provisioning() would just skip.
export async function reprovisionOrganizationAdmin(
  actorId: string,
  organizationId: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("provisioning_status")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) throw error;
  if (!org) throw new NotFoundError("Organization not found");
  if (org.provisioning_status === "ready") {
    throw new ConflictError("This organization is already provisioned.");
  }
  if (org.provisioning_status === "provisioning") {
    throw new ConflictError("Provisioning is already in progress for this organization.");
  }

  await enqueue(QUEUE_NAMES.provisionTenant, { orgId: organizationId });

  await logEvent({
    actorId,
    action: "admin.organization.reprovision_requested",
    entityType: "organization",
    entityId: organizationId,
    organizationId
  });
}
