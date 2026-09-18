import { NotFoundError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import type { Database, Json } from "@/types/database";

export type SavedView = Database["public"]["Tables"]["saved_views"]["Row"];

// specs/05-level-1-structure.md: "Required starter views seeded per tenant." Seeded lazily on
// first visit to /dashboard/views rather than inside complete_provisioning() — this also
// backfills every org provisioned before saved_views existed (all of Phase 1), not just new
// ones, without a second migration touching that function.
const CURRENT_YEAR = new Date().getFullYear();

function starterViews(): Array<{
  name: string;
  scope: "documents" | "entities";
  filters: Record<string, unknown>;
  isShared: boolean;
}> {
  return [
    { name: "All documents", scope: "documents", filters: {}, isShared: true },
    {
      name: "Documents with no connections",
      scope: "documents",
      filters: { hasNoConnections: true },
      isShared: true
    },
    {
      name: "Invoices this year",
      scope: "documents",
      filters: {
        documentTypeKey: "invoice",
        dateFrom: `${CURRENT_YEAR}-01-01`,
        dateTo: `${CURRENT_YEAR}-12-31`
      },
      isShared: true
    },
    {
      name: "Open contracts",
      scope: "entities",
      filters: { entityTypeKey: "contract" },
      isShared: true
    },
    { name: "Recently added", scope: "documents", filters: {}, isShared: true }
  ];
}

export async function listSavedViews(ctx: ServiceContext): Promise<SavedView[]> {
  const { data, error } = await ctx.db
    .from("saved_views")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

// Seeds the starter views once — a no-op if the org already has any saved views at all
// (including ones a tenant has since deleted; re-seeding after a deliberate delete would be
// surprising, so this only ever fires for a genuinely empty list).
export async function ensureStarterViews(ctx: ServiceContext): Promise<SavedView[]> {
  const existing = await listSavedViews(ctx);
  if (existing.length > 0) return existing;

  const { data, error } = await ctx.db
    .from("saved_views")
    .insert(
      starterViews().map((view) => ({
        organization_id: ctx.orgId,
        name: view.name,
        scope: view.scope,
        view_kind: "dynamic",
        filters: view.filters as Json,
        document_ids: [] as Json,
        is_shared: view.isShared,
        created_by: ctx.actorId
      }))
    )
    .select("*");

  if (error) throw error;
  return data;
}

export async function createSavedView(
  ctx: ServiceContext,
  input: {
    name: string;
    scope: "documents" | "entities";
    viewKind?: "dynamic" | "static";
    entityTypeId?: string;
    filters?: Record<string, unknown>;
    columns?: string[];
    sort?: Record<string, unknown>;
    documentIds?: string[];
    isShared?: boolean;
  }
): Promise<SavedView> {
  const viewKind = input.viewKind ?? "dynamic";
  const { data, error } = await ctx.db
    .from("saved_views")
    .insert({
      organization_id: ctx.orgId,
      name: input.name,
      scope: input.scope,
      view_kind: viewKind,
      entity_type_id: input.entityTypeId ?? null,
      filters: (input.filters ?? {}) as Json,
      columns: (input.columns ?? []) as Json,
      sort: (input.sort ?? null) as Json | null,
      document_ids: (viewKind === "static" ? (input.documentIds ?? []) : []) as Json,
      is_shared: input.isShared ?? false,
      created_by: ctx.actorId
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getSavedView(ctx: ServiceContext, id: string): Promise<SavedView> {
  const { data, error } = await ctx.db
    .from("saved_views")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .single();

  if (error) throw error;
  return data;
}

export async function renameSavedView(
  ctx: ServiceContext,
  id: string,
  name: string
): Promise<SavedView> {
  const { data, error } = await ctx.db
    .from("saved_views")
    .update({ name })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSavedView(ctx: ServiceContext, id: string): Promise<void> {
  const { error, count } = await ctx.db
    .from("saved_views")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;
  if (!count) throw new NotFoundError("Saved view not found");
}
