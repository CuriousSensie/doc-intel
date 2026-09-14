import { ConflictError, NotFoundError, ValidationError, describeError } from "@/lib/errors";
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
  other: {
    kind: ConnectableKind;
    id: string;
    label: string | null;
    // Only set for kind: "entity" — this is what lets the Connections panel group by entity
    // type (specs/05-level-1-structure.md: "the highest-value surface in the product").
    entityTypeKey: string | null;
    entityTypeName: string | null;
    // specs/05: "Deleting an entity does not hard-delete connections; it soft-deletes and the
    // UI shows 'connected entity was deleted' rather than silently dropping the link." label
    // keeps the last-known name (still useful context) rather than going null.
    isDeleted: boolean;
  };
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

  const [entityRows, documentLabels] = await Promise.all([
    entityIds.length > 0
      ? ctx.db
          .from("entities")
          .select("id, display_name, entity_type_id, deleted_at")
          .eq("organization_id", ctx.orgId)
          .in("id", entityIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            display_name: string;
            entity_type_id: string;
            deleted_at: string | null;
          }[],
          error: null
        }),
    documentIds.length > 0
      ? ctx.db
          .from("documents")
          .select("id, title, deleted_at")
          .eq("organization_id", ctx.orgId)
          .in("id", documentIds)
      : Promise.resolve({
          data: [] as { id: string; title: string; deleted_at: string | null }[],
          error: null
        })
  ]);

  if (entityRows.error) throw entityRows.error;
  if (documentLabels.error) throw documentLabels.error;

  const entityTypeIds = [...new Set((entityRows.data ?? []).map((e) => e.entity_type_id))];
  const { data: entityTypes, error: entityTypesError } =
    entityTypeIds.length > 0
      ? await ctx.db.from("entity_types").select("id, key, name").in("id", entityTypeIds)
      : { data: [] as { id: string; key: string; name: string }[], error: null };

  if (entityTypesError) throw entityTypesError;

  const entityTypeById = new Map((entityTypes ?? []).map((t) => [t.id, t]));
  const entityById = new Map((entityRows.data ?? []).map((e) => [e.id, e]));
  const documentById = new Map((documentLabels.data ?? []).map((d) => [d.id, d]));

  return rows.map((row, index) => {
    const other = others[index];

    if (other.kind === "entity") {
      const entity = entityById.get(other.id);
      const entityType = entity ? entityTypeById.get(entity.entity_type_id) : undefined;

      return {
        id: row.id,
        relation: row.relation,
        createdVia: row.created_via,
        ruleId: row.rule_id,
        createdAt: row.created_at,
        other: {
          kind: "entity" as const,
          id: other.id,
          label: entity?.display_name ?? null,
          entityTypeKey: entityType?.key ?? null,
          entityTypeName: entityType?.name ?? null,
          isDeleted: entity ? entity.deleted_at !== null : true
        }
      };
    }

    const document = documentById.get(other.id);

    return {
      id: row.id,
      relation: row.relation,
      createdVia: row.created_via,
      ruleId: row.rule_id,
      createdAt: row.created_at,
      other: {
        kind: "document" as const,
        id: other.id,
        label: document?.title ?? null,
        entityTypeKey: null,
        entityTypeName: null,
        isDeleted: document ? document.deleted_at !== null : true
      }
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

export type BulkConnectResult = {
  createdIds: string[];
  skippedIds: string[]; // already connected — ConflictError, not a failure
  failures: Array<{ id: string; error: string }>;
};

// specs/05-level-1-structure.md §Bulk business actions: "connect to entity" is the one
// required bulk primitive. Reuses createConnection per-item (so the unique-pair/self-
// connection rules never diverge between single and bulk paths) rather than a bulk insert
// that would have to reimplement them.
export async function bulkCreateConnections(
  ctx: ServiceContext,
  input: {
    sourceKind: ConnectableKind;
    sourceIds: string[];
    targetKind: ConnectableKind;
    targetId: string;
    relation?: Relation;
    createdVia?: Connection["created_via"];
  },
  onProgress?: (processed: number, total: number) => Promise<void> | void
): Promise<BulkConnectResult> {
  const createdIds: string[] = [];
  const skippedIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < input.sourceIds.length; i++) {
    const sourceId = input.sourceIds[i];
    try {
      const connection = await createConnection(ctx, {
        sourceKind: input.sourceKind,
        sourceId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        relation: input.relation,
        createdVia: input.createdVia ?? "bulk"
      });
      createdIds.push(connection.id);
    } catch (error) {
      if (error instanceof ConflictError) {
        skippedIds.push(sourceId);
      } else {
        failures.push({ id: sourceId, error: describeError(error) });
      }
    }
    if (onProgress) await onProgress(i + 1, input.sourceIds.length);
  }

  return { createdIds, skippedIds, failures };
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
