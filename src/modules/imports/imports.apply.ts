import { ConflictError } from "@/lib/errors";
import { updatePaperlessDocument } from "@/lib/paperless/documents";
import { paperlessFor } from "@/lib/paperless/client";
import type { ServiceContext } from "@/lib/service-context";
import { createConnection } from "@/modules/connections/connections.service";
import { createEntity } from "@/modules/entities/entities.service";
import { getEntityTypeByKey, getVisibleFieldSchema } from "@/modules/entity-types/entity-types.service";
import { listCustomFieldDefs } from "@/modules/custom-fields/custom-field-defs.service";

import type { ResolvedEntityLink, ResolvedFieldWrite } from "./imports.matching";

// Shared by run-import-chunk.ts (documents matched to something that already exists —
// connections/field writes apply the moment the row is processed) and
// sync-paperless-document.ts (documents newly created from an archive — connections/field
// writes can't apply until the document actually exists in our mirror, which happens on its
// own async schedule well after the chunk that created the document_uploads row finished).
// One implementation either way, so the two paths can never quietly diverge on what "apply
// this row's entity links" or "apply this row's field writes" actually means.

export async function buildCustomFieldIdByKey(ctx: ServiceContext): Promise<Map<string, number | null>> {
  const defs = await listCustomFieldDefs(ctx);
  return new Map(defs.map((def) => [def.key, def.paperless_custom_field_id]));
}

// Extracted so the identifier-population fix (below) lives in exactly one place — the "create"
// outcome shape from imports.matching.ts's resolveEntityLinksForRow().
async function createLinkedEntity(
  ctx: ServiceContext,
  link: Extract<ResolvedEntityLink, { outcome: "create" }>
): Promise<string> {
  const entityType = await getEntityTypeByKey(ctx, link.entityTypeKey);
  const data: Record<string, unknown> = {};

  // Without this, an entity auto-created via an entity link comes out with no identifier at
  // all — unfindable by the same column on a future import (found live during Phase 3 M6
  // verification; the direct entities-import path had, and was fixed for, the identical gap).
  if (link.identifierKind && link.identifierValue) {
    const field = getVisibleFieldSchema(entityType).find((f) => f.identifier_kind === link.identifierKind);
    if (field) data[field.key] = link.identifierValue;
  }

  const entity = await createEntity(ctx, { entityTypeId: entityType.id, displayName: link.displayName, data });
  return entity.id;
}

export type AppliedEntityLink =
  | { outcome: "connected"; entityId: string; connectionId: string }
  | { outcome: "already_connected"; entityId: string }
  | { outcome: "skipped" }
  | { outcome: "fail_row"; message: string };

// specs/06-importer.md §Duplicates' second clause and §Matching's on_missing all funnel
// through here — createConnection()'s own unique-pair constraint is what makes "already
// connected" a non-fatal outcome rather than a duplicate-row error.
export async function applyEntityLinks(
  ctx: ServiceContext,
  documentId: string,
  links: ResolvedEntityLink[]
): Promise<AppliedEntityLink[]> {
  const results: AppliedEntityLink[] = [];

  for (const link of links) {
    if (link.outcome === "fail_row") {
      results.push({ outcome: "fail_row", message: link.message });
      continue;
    }
    if (link.outcome === "skipped") {
      results.push({ outcome: "skipped" });
      continue;
    }

    const entityId =
      link.outcome === "linked" ? link.entityId : await createLinkedEntity(ctx, link);

    try {
      const connection = await createConnection(ctx, {
        sourceKind: "document",
        sourceId: documentId,
        targetKind: "entity",
        targetId: entityId,
        relation: link.relation,
        createdVia: "import"
      });
      results.push({ outcome: "connected", entityId, connectionId: connection.id });
    } catch (err) {
      if (err instanceof ConflictError) {
        results.push({ outcome: "already_connected", entityId });
      } else {
        throw err;
      }
    }
  }

  return results;
}

// specs/02-data-model.md: "Paperless wins on conflict" — field writes always go through to
// Paperless first (updatePaperlessDocument()), the mirror only reflects what Paperless actually
// stored, same rule documents.service.ts's updateDocument() already follows for the manual-edit
// path. A field mapped to a key with no Paperless-backed custom field (documentlink-typed —
// specs/12-agent-rules.md rule 6) is silently skipped here, not written anywhere: a documentlink
// is a connection, handled by applyEntityLinks(), never a Paperless field value.
export async function applyFieldWrites(
  ctx: ServiceContext,
  paperlessDocumentId: number,
  writes: ResolvedFieldWrite[],
  customFieldIdByKey: Map<string, number | null>
): Promise<void> {
  if (writes.length === 0) return;

  const patch: Parameters<typeof updatePaperlessDocument>[2] = {};
  const customFields: Array<{ field: number; value: unknown }> = [];

  for (const write of writes) {
    if (write.target === "document_date") {
      patch.created = write.value;
      continue;
    }
    const paperlessFieldId = customFieldIdByKey.get(write.key);
    if (paperlessFieldId == null) continue;
    customFields.push({ field: paperlessFieldId, value: write.value });
  }
  if (customFields.length > 0) patch.custom_fields = customFields;
  if (Object.keys(patch).length === 0) return;

  const client = await paperlessFor(ctx.orgId);
  const updated = await updatePaperlessDocument(client, paperlessDocumentId, patch);

  if (patch.created) {
    const { error } = await ctx.db
      .from("documents")
      .update({ document_date: updated.created ? updated.created.slice(0, 10) : null })
      .eq("paperless_document_id", paperlessDocumentId)
      .eq("organization_id", ctx.orgId);
    if (error) throw error;
  }
}
