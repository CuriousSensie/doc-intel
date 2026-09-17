import { ConflictError, NotFoundError, ValidationError, describeError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import type { ServiceContext } from "@/lib/service-context";
import type { Database } from "@/types/database";

// specs/07-rules-engine.md §Triggers: document.connected fires when a connection is created —
// scoped to whichever side is a document (rule conditions/subject context only exist for
// document/entity subjects, and the spec's own example rules read as document-centric).
// cascadeDepth starts at 0 for an organically-created connection (manual UI action or bulk
// connect); a connection created *by* a rule's own connect_entity action is enqueued separately,
// with depth + 1, from worker/jobs/run-rule.ts — never from here, since this function has no
// notion of "which rule caused this."
async function enqueueDocumentConnectedTrigger(
  ctx: ServiceContext,
  sourceKind: ConnectableKind,
  sourceId: string,
  targetKind: ConnectableKind,
  targetId: string
): Promise<void> {
  const documentId = sourceKind === "document" ? sourceId : targetKind === "document" ? targetId : null;
  if (!documentId) return;
  await enqueue(QUEUE_NAMES.runRule, {
    orgId: ctx.orgId,
    documentId,
    trigger: "document.connected",
    cascadeDepth: 0
  });
}

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

type RawConnectionRow = Connection;
type OtherRef = { kind: ConnectableKind; id: string };

// Shared by getConnections() (needs the full rows, then hydrates labels) and
// listConnectedIds() (needs only the "other side" ids — documents.service.ts's `entityId`
// filter used to call getConnections() just to throw the label hydration away; that's the
// duplicated union-query logic this centralizes).
async function queryRawConnections(
  ctx: ServiceContext,
  kind: ConnectableKind,
  id: string
): Promise<{ rows: RawConnectionRow[]; others: OtherRef[] }> {
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

  return { rows, others };
}

// The lightweight half of getConnections() — just which records the other side is, no label
// hydration. documents.service.ts's `entityId` filter (find every document connected to this
// entity) needs exactly this and nothing else; the entity/document display-name lookups
// getConnections() also does are pure overhead for a filter that only needs ids.
export async function listConnectedIds(
  ctx: ServiceContext,
  kind: ConnectableKind,
  id: string
): Promise<OtherRef[]> {
  return (await queryRawConnections(ctx, kind, id)).others;
}

// The one required helper (specs/05-level-1-structure.md §Connections): a union query over
// both directions, hydrated with the *other* side's minimal display info. No other feature
// code is allowed to hand-roll this direction logic.
export async function getConnections(
  ctx: ServiceContext,
  kind: ConnectableKind,
  id: string
): Promise<ConnectionWithOther[]> {
  const { rows, others } = await queryRawConnections(ctx, kind, id);

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

// specs/10-nonfunctional.md isolation test #9: "A creates a connection targeting B's entity
// id" must 404/422, not silently succeed. `connections` has no FK on source_id/target_id
// (polymorphic by design, specs/02's own "do not fix this" note) — without this check, nothing
// stopped an insert with organization_id: A's org but a target_id belonging to another
// tenant's entity/document, since the row itself carries no per-side ownership constraint.
async function assertBelongsToOrg(
  ctx: ServiceContext,
  kind: ConnectableKind,
  id: string
): Promise<void> {
  const table = kind === "entity" ? "entities" : "documents";
  const { data, error } = await ctx.db
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError(`${kind} not found`);
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

  await Promise.all([
    assertBelongsToOrg(ctx, input.sourceKind, input.sourceId),
    assertBelongsToOrg(ctx, input.targetKind, input.targetId)
  ]);

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

  await enqueueDocumentConnectedTrigger(ctx, input.sourceKind, input.sourceId, input.targetKind, input.targetId);

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
// Phase 3 M7 rewrite: the importer needs this exact primitive at 500+ items and
// specs/10-nonfunctional.md's target is < 30s — the original per-item loop (~4 round trips per
// item: 2 ownership checks + 1 insert + 1 audit write, all serial) couldn't get there. Every
// item shares the same target, so target ownership is checked once instead of per item; source
// ownership and pre-existing-connection checks are each one batched query instead of N; the
// insert is one statement instead of N; one audit row summarizes the whole call instead of one
// per connection. The `BulkConnectResult` contract (createdIds/skippedIds/failures) is
// unchanged — worker/jobs/bulk-action.ts and the undo path don't need to know this changed.
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
  const relation = input.relation ?? "related";
  const createdVia = input.createdVia ?? "bulk";
  const total = input.sourceIds.length;
  const failures: Array<{ id: string; error: string }> = [];

  if (onProgress) await onProgress(0, total);

  const candidateIds = [...new Set(input.sourceIds)].filter((id) => {
    if (input.sourceKind === input.targetKind && id === input.targetId) {
      failures.push({ id, error: "Cannot connect a record to itself" });
      return false;
    }
    return true;
  });

  if (candidateIds.length === 0) {
    if (onProgress) await onProgress(total, total);
    return { createdIds: [], skippedIds: [], failures };
  }

  // Checked once, not per item — every candidate connects to the same fixed target.
  await assertBelongsToOrg(ctx, input.targetKind, input.targetId);

  const sourceTable = input.sourceKind === "entity" ? "entities" : "documents";
  const { data: validRows, error: validError } = await ctx.db
    .from(sourceTable)
    .select("id")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .in("id", candidateIds);
  if (validError) throw validError;

  const validIds = new Set((validRows ?? []).map((r) => r.id as string));
  for (const id of candidateIds) {
    if (!validIds.has(id)) failures.push({ id, error: `${input.sourceKind} not found` });
  }
  const ownedIds = candidateIds.filter((id) => validIds.has(id));

  if (ownedIds.length === 0) {
    if (onProgress) await onProgress(total, total);
    return { createdIds: [], skippedIds: [], failures };
  }

  // connections_unique_pair is symmetric (least/greatest of the two ids) — an existing row
  // could have source/target swapped relative to this call, so both orderings are checked in
  // the same query rather than reimplementing the DB's own constraint logic per row.
  const { data: existingRows, error: existingError } = await ctx.db
    .from("connections")
    .select("source_kind, source_id, target_kind, target_id")
    .eq("organization_id", ctx.orgId)
    .eq("relation", relation)
    .is("deleted_at", null)
    .or(
      `and(source_kind.eq.${input.sourceKind},target_kind.eq.${input.targetKind},target_id.eq.${input.targetId}),` +
        `and(source_kind.eq.${input.targetKind},target_kind.eq.${input.sourceKind},source_id.eq.${input.targetId})`
    );
  if (existingError) throw existingError;

  const alreadyConnected = new Set<string>();
  for (const row of existingRows ?? []) {
    if (row.target_id === input.targetId && row.source_kind === input.sourceKind) {
      alreadyConnected.add(row.source_id);
    }
    if (row.source_id === input.targetId && row.target_kind === input.sourceKind) {
      alreadyConnected.add(row.target_id);
    }
  }

  const skippedIds = ownedIds.filter((id) => alreadyConnected.has(id));
  const toInsert = ownedIds.filter((id) => !alreadyConnected.has(id));

  if (toInsert.length === 0) {
    if (onProgress) await onProgress(total, total);
    return { createdIds: [], skippedIds, failures };
  }

  const rowsToInsert = toInsert.map((sourceId) => ({
    organization_id: ctx.orgId,
    source_kind: input.sourceKind,
    source_id: sourceId,
    target_kind: input.targetKind,
    target_id: input.targetId,
    relation,
    created_via: createdVia,
    created_by: ctx.actorId
  }));

  const { data: inserted, error: insertError } = await ctx.db
    .from("connections")
    .insert(rowsToInsert)
    .select("id, source_id");

  let createdIds: string[];

  if (insertError) {
    // A concurrent request created one of these same pairs between the pre-check above and
    // this insert — rare (bulk-connect targets are not typically under concurrent write
    // pressure), but a single-statement multi-row insert fails atomically, so this falls back
    // to the old per-item loop only for the conflicting batch rather than losing the whole
    // bulk operation to a race the pre-check couldn't fully rule out.
    if (insertError.code !== UNIQUE_VIOLATION) throw insertError;
    createdIds = [];
    for (const sourceId of toInsert) {
      try {
        const connection = await createConnection(ctx, {
          sourceKind: input.sourceKind,
          sourceId,
          targetKind: input.targetKind,
          targetId: input.targetId,
          relation,
          createdVia
        });
        createdIds.push(connection.id);
      } catch (err) {
        if (err instanceof ConflictError) {
          skippedIds.push(sourceId);
        } else {
          failures.push({ id: sourceId, error: describeError(err) });
        }
      }
    }
  } else {
    createdIds = (inserted ?? []).map((row) => row.id);

    // The fallback per-item loop above already triggers document.connected via createConnection()
    // itself; this fast batch-insert path bypasses that function entirely, so it fires the
    // trigger explicitly here — one job per created connection touching a document, matching how
    // every other per-document rule trigger in this codebase fans out (never a batch payload).
    if (input.sourceKind === "document" || input.targetKind === "document") {
      await Promise.all(
        (inserted ?? []).map((row) =>
          enqueueDocumentConnectedTrigger(ctx, input.sourceKind, row.source_id, input.targetKind, input.targetId)
        )
      );
    }
  }

  if (createdIds.length > 0) {
    // One batched audit entry for the whole call, not one per connection — the same "batch
    // the writes" principle specs/06-importer.md states explicitly for import counters applies
    // here too; 500 individual logEvent() calls was part of what this rewrite exists to fix.
    await logEvent({
      actorId: ctx.actorId,
      action: "connection.bulk_created",
      entityType: "connection",
      entityId: input.targetId,
      organizationId: ctx.orgId,
      metadata: {
        source_kind: input.sourceKind,
        target_kind: input.targetKind,
        target_id: input.targetId,
        relation,
        created_via: createdVia,
        count: createdIds.length
      }
    });
  }

  if (onProgress) await onProgress(total, total);

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
