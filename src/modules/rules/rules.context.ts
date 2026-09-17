import { paperlessFor } from "@/lib/paperless/client";
import { getPaperlessDocument } from "@/lib/paperless/documents";
import { getCachedCorrespondentName, getCachedTags } from "@/lib/paperless/metadata-cache";
import { PaperlessUnavailableError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import { listConnectedIds } from "@/modules/connections/connections.service";
import { listCustomFieldDefs, type CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";

// The flat, evaluator-facing shape rules.evaluator.ts reads condition field paths against.
// Built once per document per trigger fire (rules.dispatcher.ts's caller), not per rule — every
// enabled rule for the trigger evaluates against the same subject.
export type DocumentSubjectContext = {
  kind: "document";
  documentId: string;
  paperlessDocumentId: number;
  fields: {
    "document.type": string | null;
    "document.title": string;
    "document.content": string | null;
    "document.correspondent": string | null;
    "document.date": string | null;
    "document.tags": string[]; // tag names, resolved below — condition values are author-facing
    "document.filename": string | null;
    "document.source": string;
    "connection.count": number;
  };
  custom: Record<string, unknown>; // document.custom.<key>
  paperlessAvailable: boolean;
  // Fetched once here, reused by rules.dispatcher.ts's set_custom_field action so a matched
  // rule doesn't re-issue the same listCustomFieldDefs() query the context builder already ran.
  customFieldDefs: CustomFieldDef[];
};

// specs/07-rules-engine.md §Condition fields: document.content is OCR text fetched live from
// Paperless, never mirrored (12-agent-rules.md rule 7). A Paperless outage degrades the subject
// (paperlessAvailable: false, content/tags/correspondent all null) rather than throwing — the
// caller (worker/jobs/run-rule.ts) still runs every rule; conditions reading a degraded field
// simply evaluate false, which conditions_trace makes visible as "value: null" rather than
// crashing the whole document's rule pass.
export async function buildDocumentSubjectContext(
  ctx: ServiceContext,
  documentId: string
): Promise<DocumentSubjectContext> {
  const { data: doc, error } = await ctx.db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!doc) throw new PaperlessUnavailableError("Document not found for rule evaluation");

  const connectionCount = (await listConnectedIds(ctx, "document", documentId)).length;

  let content: string | null = null;
  let correspondentName: string | null = null;
  let tagNames: string[] = [];
  const custom: Record<string, unknown> = {};
  let paperlessAvailable = true;
  // Fetched outside the try/catch — a Paperless outage shouldn't also lose our own DB's field
  // defs, and the dispatcher needs this list regardless of whether the Paperless fetch below
  // succeeds (a set_custom_field action can still no-op cleanly with an empty custom map).
  const customFieldDefs = await listCustomFieldDefs(ctx);

  try {
    const client = await paperlessFor(ctx.orgId);
    // getCachedTags/getCachedCorrespondentName (src/lib/paperless/metadata-cache.ts, Redis,
    // 5 min TTL) — every rule evaluation used to re-fetch the tenant's full tag list and do an
    // uncached correspondent lookup on every document.ingested/.updated/.connected fire, the
    // same N+1-across-events pattern metadata-cache.ts already exists to prevent for
    // sync-paperless-document.ts. rules.dispatcher.ts's find-or-create helpers already used the
    // cache; this context builder was the one place that didn't.
    const [paperlessDoc, allTags] = await Promise.all([
      getPaperlessDocument(client, doc.paperless_document_id),
      getCachedTags(client, ctx.orgId)
    ]);
    content = paperlessDoc.content;
    correspondentName = paperlessDoc.correspondent
      ? await getCachedCorrespondentName(client, ctx.orgId, paperlessDoc.correspondent)
      : null;
    // Tag *names* (not ids) are what a rule author writes conditions against — resolving every
    // tag id to a name here (rather than exposing ids) keeps the DSL's `document.tags` values
    // human-authored strings, matching how document.correspondent is a name, not an id.
    const tagById = new Map(allTags.map((t) => [t.id, t.name]));
    tagNames = paperlessDoc.tags.map((id) => tagById.get(id)).filter((n): n is string => !!n);

    // document.custom.<key> uses our own field key (custom_field_defs.key), not Paperless's
    // numeric field id — the id is an implementation detail a rule author never sees or writes.
    const keyByPaperlessFieldId = new Map(
      customFieldDefs
        .filter((d) => d.paperless_custom_field_id !== null)
        .map((d) => [d.paperless_custom_field_id, d.key])
    );
    for (const cf of paperlessDoc.custom_fields) {
      const key = keyByPaperlessFieldId.get(cf.field);
      if (key) custom[key] = cf.value;
    }
  } catch {
    paperlessAvailable = false;
  }

  return {
    kind: "document",
    documentId,
    paperlessDocumentId: doc.paperless_document_id,
    fields: {
      "document.type": doc.document_type_key,
      "document.title": doc.title,
      "document.content": content,
      "document.correspondent": correspondentName ?? doc.correspondent_name,
      "document.date": doc.document_date,
      "document.tags": tagNames,
      "document.filename": doc.title,
      "document.source": doc.source,
      "connection.count": connectionCount
    },
    custom,
    paperlessAvailable,
    customFieldDefs
  };
}

export type EntitySubjectContext = {
  kind: "entity";
  entityId: string;
  fields: {
    "entity.type": string;
    "connection.count": number;
  };
  data: Record<string, unknown>; // entity.data.<key>
};

// entity.created is a much simpler subject: no Paperless round-trip, the entity row + its own
// entity type key + connection count is everything specs/07's `entity.*`/`connection.count`
// condition fields need.
export async function buildEntitySubjectContext(
  ctx: ServiceContext,
  entityId: string
): Promise<EntitySubjectContext> {
  const { data: entity, error } = await ctx.db
    .from("entities")
    .select("*, entity_types(key)")
    .eq("id", entityId)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!entity) throw new PaperlessUnavailableError("Entity not found for rule evaluation");

  const connectionCount = (await listConnectedIds(ctx, "entity", entityId)).length;
  const entityTypeKey = (entity as unknown as { entity_types: { key: string } | null }).entity_types?.key ?? "";

  return {
    kind: "entity",
    entityId,
    fields: {
      "entity.type": entityTypeKey,
      "connection.count": connectionCount
    },
    data: (entity.data as Record<string, unknown>) ?? {}
  };
}

export type SubjectContext = DocumentSubjectContext | EntitySubjectContext;
