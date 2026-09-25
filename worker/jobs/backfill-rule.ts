import { randomUUID } from "node:crypto";

import type { Job } from "bullmq";

import { rulesConfig } from "@/config/rules";
import { logger } from "@/lib/logger";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { getRuleBackfillControl } from "@/lib/rules/backfill-control";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceContext } from "@/lib/service-context";
import { buildDocumentSubjectContext } from "@/modules/rules/rules.context";
import { dispatchRuleActions } from "@/modules/rules/rules.dispatcher";
import { evaluateConditions } from "@/modules/rules/rules.evaluator";
import type { ConditionNode } from "@/modules/rules/rules.schemas";
import { createNotification } from "@/modules/notifications/notifications.service";
import type { JobPayload } from "../context";

type BackfillRulePayload = JobPayload & { ruleBackfillId: string };
type AdminDb = ReturnType<typeof createAdminClient>;
type BackfillFilter = { documentTypeKey?: string; dateFrom?: string; dateTo?: string };

// Each document's own work is a Paperless round trip (buildDocumentSubjectContext) plus a couple
// of DB writes — dominated by network latency, not CPU, so running the chunk's up-to-50
// documents one at a time serialized every bit of that latency. A small bounded pool gets real
// wall-clock improvement on a 5,000-document backfill without the complexity of a queue-based
// fan-out for what's still one chunk of one job. rulesConfig has no dedicated constant for this
// yet since nothing else in the rules engine needed one — kept local rather than adding a config
// knob for a single call site.
const BACKFILL_DOCUMENT_CONCURRENCY = 8;

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++];
      await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// Serializes calls through this function to at most one in flight at a time. Concurrent
// dispatchRuleActions() calls (Paperless field/tag writes) against the pinned all-in-one
// Paperless instance were observed live to deadlock its Django ORM (auditlog signal + tags m2m
// update on the same tag row), leaving Postgres backends stuck `idle in transaction` and the
// backfill's applied_count permanently at 0 — reproduced with BACKFILL_DOCUMENT_CONCURRENCY's
// full fan-out hitting the same tag concurrently. Reads (buildDocumentSubjectContext,
// evaluateConditions) don't write to Paperless and stay concurrent; only the write path is
// serialized, so this keeps most of the concurrency's wall-clock benefit.
function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

async function claimChunk(admin: AdminDb, orgId: string, ruleBackfillId: string, filter: BackfillFilter) {
  const { data, error } = await admin.rpc("claim_rule_backfill_documents", {
    p_rule_backfill_id: ruleBackfillId,
    p_organization_id: orgId,
    p_limit: rulesConfig.backfillChunkSize,
    p_document_type_key: filter.documentTypeKey ?? null,
    p_date_from: filter.dateFrom ?? null,
    p_date_to: filter.dateTo ?? null
  });
  if (error) throw error;
  return data ?? [];
}

async function tryFinalize(admin: AdminDb, orgId: string, ruleBackfillId: string): Promise<void> {
  const { data: didComplete, error } = await admin.rpc("complete_rule_backfill", {
    p_rule_backfill_id: ruleBackfillId,
    p_organization_id: orgId
  });
  if (error) throw error;
  if (!didComplete) return;

  const { data: backfill } = await admin
    .from("rule_backfills")
    .select("created_by, matched_count, applied_count, rule_id")
    .eq("id", ruleBackfillId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!backfill?.created_by) return;

  const { data: rule } = await admin.from("rules").select("name").eq("id", backfill.rule_id).maybeSingle();

  await createNotification(backfill.created_by, {
    type: "rule.backfill_completed",
    title: "Rule backfill finished",
    message: `"${rule?.name ?? "Rule"}" backfill finished: ${backfill.matched_count} matched, ${backfill.applied_count} applied.`,
    metadata: { ruleBackfillId }
  });
}

// specs/07-rules-engine.md §Dry run and backfill: chunked, pausable, fully audited, reversible.
// A self-perpetuating chain — a Redis control flag checked before each claim, cursor-based
// pagination over the filtered document set (see claim_rule_backfill_documents() in the migration
// for why this isn't a row-claim table), one re-enqueue per chunk while still running.
// rule_backfills.status is documented as worker-managed (no update RLS policy for authenticated
// users) — pauseRuleBackfillAction()/cancelRuleBackfillAction() only ever set the Redis control
// flag, so without this the DB row (and the UI reading it) stayed stuck on "running" forever
// after a pause/cancel, even though the job chain had genuinely stopped re-enqueuing itself.
// Called from two places: the top-of-job guard (a job that starts and finds itself already
// paused/cancelled) and the end-of-chunk re-enqueue decision (a job that was "running" when it
// started but got paused/cancelled while it was mid-chunk) — the second is the common real path,
// since a pause/cancel almost always lands while a chunk is in flight, not between chunks. Only
// overwrites a still-"running" row — never clobbers a terminal completed/failed status a
// concurrent final chunk may have already written.
async function persistNonRunningStatus(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  ruleBackfillId: string,
  control: "paused" | "cancelled"
): Promise<void> {
  await admin
    .from("rule_backfills")
    .update({
      status: control,
      finished_at: control === "cancelled" ? new Date().toISOString() : null
    })
    .eq("id", ruleBackfillId)
    .eq("organization_id", orgId)
    .eq("status", "running");
}

export async function backfillRuleJob(job: Job<JobPayload>): Promise<void> {
  const { orgId, ruleBackfillId } = job.data as BackfillRulePayload;

  const control = await getRuleBackfillControl(ruleBackfillId);
  if (control !== "running") {
    logger.info("rules.backfill.stopped", { orgId, ruleBackfillId, control });
    if (control === "paused" || control === "cancelled") {
      await persistNonRunningStatus(createAdminClient(), orgId, ruleBackfillId, control);
    }
    return;
  }

  const admin = createAdminClient();

  // resumeRuleBackfillAction() only sets the Redis control flag back to "running" and
  // re-enqueues — it never touches this row (same "worker-managed status" reasoning as above),
  // so a resumed backfill's DB status is still "paused" here. claim_rule_backfill_documents()
  // internally requires status='running' to return any cursor at all; without this, a resume
  // would silently claim zero documents and tryFinalize() would mark the backfill "completed"
  // after only a partial run. Idempotent no-op once already "running".
  await admin
    .from("rule_backfills")
    .update({ status: "running" })
    .eq("id", ruleBackfillId)
    .eq("organization_id", orgId)
    .eq("status", "paused");

  const { data: backfill, error: backfillError } = await admin
    .from("rule_backfills")
    .select("*")
    .eq("id", ruleBackfillId)
    .eq("organization_id", orgId)
    .single();
  if (backfillError) throw backfillError;

  const { data: rule, error: ruleError } = await admin
    .from("rules")
    .select("*")
    .eq("id", backfill.rule_id)
    .eq("organization_id", orgId)
    .single();
  if (ruleError) throw ruleError;

  const filter = (backfill.filter as BackfillFilter) ?? {};
  const documents = await claimChunk(admin, orgId, ruleBackfillId, filter);

  if (documents.length === 0) {
    await tryFinalize(admin, orgId, ruleBackfillId);
    return;
  }

  const ctx: ServiceContext = { db: admin, orgId, actorId: backfill.created_by, correlationId: randomUUID() };
  let matchedDelta = 0;
  let appliedDelta = 0;
  // claim_rule_backfill_documents() orders by d.id — the last element is the max regardless of
  // the concurrent processing order below, so the cursor only needs to be set once after the
  // whole chunk finishes, not tracked per-iteration.
  const lastDocumentId = documents[documents.length - 1]?.id ?? backfill.cursor_document_id;
  const withPaperlessWriteLock = createMutex();

  await mapWithConcurrency(documents, BACKFILL_DOCUMENT_CONCURRENCY, async (doc) => {
    try {
      const subject = await buildDocumentSubjectContext(ctx, doc.id);
      const { matched, trace } = evaluateConditions(rule.conditions as unknown as ConditionNode, subject);

      const { data: ruleRun, error: ruleRunError } = await admin
        .from("rule_runs")
        .insert({
          organization_id: orgId,
          rule_id: rule.id,
          document_id: doc.id,
          trigger: "manual",
          matched,
          conditions_trace: trace as never,
          status: "ok",
          cascade_depth: 0
        })
        .select("id")
        .single();
      if (ruleRunError) throw ruleRunError;

      if (matched) {
        matchedDelta++;
        const fieldClaims = new Map<string, string>();
        const outcomes = await withPaperlessWriteLock(() =>
          dispatchRuleActions(ctx, rule, ruleRun.id, subject, fieldClaims)
        );
        if (outcomes.some((o) => o.status === "applied")) appliedDelta++;
      }
    } catch (err) {
      logger.error("rules.backfill.document_failed", {
        orgId,
        ruleBackfillId,
        documentId: doc.id,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  });

  if (lastDocumentId) {
    const { error } = await admin.rpc("advance_rule_backfill_cursor", {
      p_rule_backfill_id: ruleBackfillId,
      p_organization_id: orgId,
      p_cursor_document_id: lastDocumentId
    });
    if (error) throw error;
  }

  if (matchedDelta > 0 || appliedDelta > 0) {
    const { error } = await admin.rpc("increment_rule_backfill_progress", {
      p_rule_backfill_id: ruleBackfillId,
      p_organization_id: orgId,
      p_matched_delta: matchedDelta,
      p_applied_delta: appliedDelta
    });
    if (error) throw error;
  }

  const nextControl = await getRuleBackfillControl(ruleBackfillId);
  if (nextControl === "running") {
    await enqueue(QUEUE_NAMES.backfillRule, { orgId, ruleBackfillId });
  } else if (nextControl === "paused" || nextControl === "cancelled") {
    await persistNonRunningStatus(admin, orgId, ruleBackfillId, nextControl);
  }
}
