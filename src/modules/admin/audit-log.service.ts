import { decodeCursor, encodeCursor } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type AuditLogEntry = Database["public"]["Tables"]["audit_logs"]["Row"];

const DEFAULT_PAGE_SIZE = 20;

export async function listAuditLogs(
  options: { cursor?: string | null; limit?: number } = {}
): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
  const supabase = await createClient();
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCursor(options.cursor);

  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

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

// specs/03-api.md's GET /audit "filter by subject" — audit history for one entity (a document,
// an organization_member, etc.) rather than the app-admin global feed above. Scoping is RLS
// alone (audit_logs_select_admins: app admin, or an org owner/admin for their own org's rows) —
// this adds no authorization of its own, same as listAuditLogs().
export async function listAuditLogsForSubject(
  entityType: string,
  entityId: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
  const supabase = await createClient();
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCursor(options.cursor);

  let query = supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

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
