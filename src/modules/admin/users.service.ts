import { AuthorizationError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/modules/auth/session";

const DEFAULT_PAGE_SIZE = 20;

export async function listUsers(
  options: { cursor?: string | null; limit?: number; search?: string } = {}
): Promise<{ items: Profile[]; nextCursor: string | null }> {
  const supabase = await createClient();
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCursor(options.cursor);

  let query = supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (options.search) {
    query = query.ilike("email", `%${options.search}%`);
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

export async function suspendUser(actorId: string, userId: string): Promise<void> {
  if (actorId === userId) {
    throw new AuthorizationError("You cannot suspend your own account");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ suspended_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    throw error;
  }

  await logEvent({ actorId, action: "admin.user.suspended", entityType: "user", entityId: userId });
}

export async function unsuspendUser(actorId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ suspended_at: null }).eq("id", userId);

  if (error) {
    throw error;
  }

  await logEvent({ actorId, action: "admin.user.unsuspended", entityType: "user", entityId: userId });
}

export async function setAppAdmin(actorId: string, userId: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin && actorId === userId) {
    throw new AuthorizationError("You cannot revoke your own admin access");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ is_app_admin: isAdmin }).eq("id", userId);

  if (error) {
    throw error;
  }

  await logEvent({
    actorId,
    action: isAdmin ? "admin.user.admin_granted" : "admin.user.admin_revoked",
    entityType: "user",
    entityId: userId
  });
}

/**
 * Deletes any organization the target user is the *sole* remaining owner of before deleting the
 * user, so a solely-owned organization is never left ownerless — the FK cascades from there take
 * care of every other row (memberships, invitations, billing, files, etc.) tied to either the
 * org or the user.
 */
export async function deleteUserAdmin(actorId: string, userId: string): Promise<void> {
  if (actorId === userId) {
    throw new AuthorizationError("You cannot delete your own account");
  }

  const admin = createAdminClient();

  const { data: ownedOrganizations, error: ownedError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "owner");

  if (ownedError) {
    throw ownedError;
  }

  for (const { organization_id: organizationId } of ownedOrganizations ?? []) {
    const { count, error: countError } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "owner")
      .neq("user_id", userId);

    if (countError) {
      throw countError;
    }

    if ((count ?? 0) === 0) {
      const { error: deleteOrgError } = await admin.from("organizations").delete().eq("id", organizationId);

      if (deleteOrgError) {
        throw deleteOrgError;
      }

      await logEvent({
        actorId,
        action: "organization.deleted",
        entityType: "organization",
        entityId: organizationId,
        organizationId,
        metadata: { reason: "sole_owner_deleted" }
      });
    }
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);

  if (deleteUserError) {
    throw deleteUserError;
  }

  await logEvent({ actorId, action: "admin.user.deleted", entityType: "user", entityId: userId });
}
