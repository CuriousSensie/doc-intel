import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import type { ServiceContext } from "@/lib/service-context";
import type { Database } from "@/types/database";

export type Connection = Database["public"]["Tables"]["connections"]["Row"];
export type ConnectableKind = Connection["source_kind"];
export type Relation = Connection["relation"];

export type ConnectionWithOther = {
  id: string;
  relation: Relation;
  createdVia: Connection["created_via"];
  ruleId: string | null;
  createdAt: string;
  other: { kind: ConnectableKind; id: string; label: string | null };
};

const UNIQUE_VIOLATION = "23505";

// The one required helper (specs/05-level-1-structure.md §Connections): a union query over
// both directions, hydrated with the *other* side's minimal display info. No other feature
// code is allowed to hand-roll this direction logic.
export async function getConnections(
  ctx: ServiceContext,
  kind: ConnectableKind,
  id: string
): Promise<ConnectionWithOther[]> {
  const { data, error } = await ctx.db
    .from("connections")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .or(
      `and(source_kind.eq.${kind},source_id.eq.${id}),and(target_kind.eq.${kind},target_id.eq.${id})`
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];

  const others = rows.map((row) => {
    const isSource = row.source_kind === kind && row.source_id === id;
    return isSource
      ? { kind: row.target_kind, id: row.target_id }
      : { kind: row.source_kind, id: row.source_id };
  });

  const entityIds = [...new Set(others.filter((o) => o.kind === "entity").map((o) => o.id))];
  const documentIds = [...new Set(others.filter((o) => o.kind === "document").map((o) => o.id))];

  const [entityLabels, documentLabels] = await Promise.all([
    entityIds.length > 0
      ? ctx.db
          .from("entities")
          .select("id, display_name")
          .eq("organization_id", ctx.orgId)
          .in("id", entityIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[], error: null }),
    documentIds.length > 0
      ? ctx.db
          .from("documents")
          .select("id, title")
          .eq("organization_id", ctx.orgId)
          .in("id", documentIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null })
  ]);

  if (entityLabels.error) throw entityLabels.error;
  if (documentLabels.error) throw documentLabels.error;

  const entityLabelById = new Map((entityLabels.data ?? []).map((e) => [e.id, e.display_name]));
  const documentLabelById = new Map((documentLabels.data ?? []).map((d) => [d.id, d.title]));

  return rows.map((row, index) => {
    const other = others[index];
    const label =
      other.kind === "entity"
        ? (entityLabelById.get(other.id) ?? null)
        : (documentLabelById.get(other.id) ?? null);

    return {
      id: row.id,
      relation: row.relation,
      createdVia: row.created_via,
      ruleId: row.rule_id,
      createdAt: row.created_at,
      other: { kind: other.kind, id: other.id, label }
    };
  });
}

export async function createConnection(
  ctx: ServiceContext,
  input: {
    sourceKind: ConnectableKind;
    sourceId: string;
    targetKind: ConnectableKind;
    targetId: string;
    relation?: Relation;
    createdVia?: Connection["created_via"];
    ruleId?: string | null;
  }
): Promise<Connection> {
  if (input.sourceKind === input.targetKind && input.sourceId === input.targetId) {
    throw new ValidationError("Cannot connect a record to itself");
  }

  const { data, error } = await ctx.db
    .from("connections")
    .insert({
      organization_id: ctx.orgId,
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      target_kind: input.targetKind,
      target_id: input.targetId,
      relation: input.relation ?? "related",
      created_via: input.createdVia ?? "manual",
      rule_id: input.ruleId ?? null,
      created_by: ctx.actorId
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new ConflictError("This connection already exists");
    }
    throw error;
  }

  await logEvent({
    actorId: ctx.actorId,
    action: "connection.created",
    entityType: "connection",
    entityId: data.id,
    organizationId: ctx.orgId,
    metadata: {
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      target_kind: input.targetKind,
      target_id: input.targetId,
      relation: data.relation,
      created_via: data.created_via,
      rule_id: data.rule_id
    }
  });

  return data;
}

export async function deleteConnection(ctx: ServiceContext, connectionId: string): Promise<void> {
  const { data: existing, error: fetchError } = await ctx.db
    .from("connections")
    .select("id")
    .eq("id", connectionId)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!existing) throw new NotFoundError("Connection not found");

  const { error } = await ctx.db
    .from("connections")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;

  await logEvent({
    actorId: ctx.actorId,
    action: "connection.deleted",
    entityType: "connection",
    entityId: connectionId,
    organizationId: ctx.orgId
  });
}
