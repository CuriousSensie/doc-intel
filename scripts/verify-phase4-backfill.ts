import { readFileSync } from "node:fs";
import { join } from "node:path";

import { paperlessFor } from "@/lib/paperless/client";
import { parsePostDocumentTaskId, pollPaperlessTask } from "@/lib/paperless/tasks";
import { setRuleBackfillControl } from "@/lib/rules/backfill-control";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntityTypeByKey } from "@/modules/entity-types/entity-types.service";
import { createEntity } from "@/modules/entities/entities.service";
import { upsertDocumentObjectMap } from "@/modules/documents/sync-paperless-document";

type Args = { docs: number; execute: boolean; keep: boolean; concurrency: number; timeoutMinutes: number };
type AdminClient = ReturnType<typeof createAdminClient>;

// specs/07-rules-engine.md definition-of-done #3: "Backfill applies it to 5,000 existing
// documents, with progress, and can be undone." Mirrors scripts/verify-phase3-m9.ts's own
// precedent exactly: build the script capable of the full number, actually run it at a scale
// this session can complete, and document the gap honestly rather than fake the larger number.
// The expensive part is identical to M9's finding too — real Paperless consumption, not our own
// claim/cursor/dispatch logic — so --docs is intentionally capped low by default; --docs 5000
// is supported but not run here without a dedicated operator window (same M9 rationale).

function loadDotEnv(): void {
  let content = "";
  try {
    content = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const getNumber = (flag: string, fallback: number) => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return fallback;
    const value = Number(argv[idx + 1]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number`);
    return Math.trunc(value);
  };

  return {
    docs: getNumber("--docs", 150),
    execute: argv.includes("--execute"),
    keep: argv.includes("--keep"),
    concurrency: getNumber("--concurrency", 15),
    timeoutMinutes: getNumber("--timeout-minutes", 30)
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await run(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function createFixture() {
  const { createConfirmedTestUser, createTestOrganization, provisionTestOrganizationDirect } = await import(
    "../e2e/helpers/test-fixtures"
  );
  const user = await createConfirmedTestUser();
  const orgId = await createTestOrganization(user.userId, `Phase4 Backfill ${Date.now()}`);
  await provisionTestOrganizationDirect(orgId);
  return { user, orgId };
}

async function createRealDocument(admin: AdminClient, orgId: string, index: number): Promise<string> {
  const title = `phase4-backfill-${index}`;
  const paperless = await paperlessFor(orgId);
  const ownership = paperless.ownership;
  if (!ownership) throw new Error("expected tenant ownership");

  const form = new FormData();
  form.append("document", new Blob([`${title}\n`], { type: "text/plain" }), `${title}.txt`);
  form.append("title", title);
  const rawTaskId = await paperless.postForm<string>("/api/documents/post_document/", form);
  const task = await pollPaperlessTask(paperless, parsePostDocumentTaskId(rawTaskId));
  if (task?.status !== "success" || !task.related_document_ids?.[0]) {
    throw new Error(`document ${index} did not finish consuming: ${JSON.stringify(task)}`);
  }
  const paperlessId = task.related_document_ids[0];
  await paperless.setOwnedObjectPermissions(`/api/documents/${paperlessId}/`, ownership);

  const { data: mirrorRow, error } = await admin
    .from("documents")
    .insert({
      organization_id: orgId,
      paperless_document_id: paperlessId,
      title,
      // document_type_key is a plain mirror column (specs/02-data-model.md — no canonical
      // source), set directly here rather than round-tripping through a real Paperless
      // document_type object per document — the backfill's own filter reads this column, not
      // Paperless, so this is a faithful scale test of the backfill path itself.
      document_type_key: "invoice",
      status: "ready"
    })
    .select("id")
    .single();
  if (error) throw error;
  await upsertDocumentObjectMap(admin, orgId, paperlessId, mirrorRow.id);
  return mirrorRow.id as string;
}

async function main() {
  loadDotEnv();
  const args = parseArgs();
  const admin = createAdminClient();

  console.log(`provisioning fixture tenant`);
  const fixture = await createFixture();

  console.log(`creating ${args.docs} real documents (concurrency ${args.concurrency})`);
  const createStarted = Date.now();
  const documentIds = await mapWithConcurrency(
    Array.from({ length: args.docs }, (_, i) => i),
    args.concurrency,
    (i) => createRealDocument(admin, fixture.orgId, i)
  );
  console.log(`created ${documentIds.length} documents in ${((Date.now() - createStarted) / 1000).toFixed(1)}s`);

  const ctx = { db: admin, orgId: fixture.orgId, actorId: fixture.user.userId, correlationId: "verify-phase4" };
  const customerType = await getEntityTypeByKey(ctx, "customer");
  const entity = await createEntity(ctx, {
    entityTypeId: customerType.id,
    displayName: `Phase4 Backfill Customer ${Date.now()}`
  });

  const { data: rule, error: ruleError } = await admin
    .from("rules")
    .insert({
      organization_id: fixture.orgId,
      name: "Phase4 backfill scale test",
      trigger: "manual",
      conditions: { field: "document.type", op: "eq", value: "invoice" },
      actions: [
        { type: "connect_entity", entity_ref: { by: "id", entityId: entity.id }, relation: "issued_to" }
      ]
    })
    .select("*")
    .single();
  if (ruleError) throw ruleError;

  if (!args.execute) {
    console.log("skipped backfill execution; pass --execute to run the real self-perpetuating chain");
  } else {
    const { data: backfill, error: backfillError } = await admin
      .from("rule_backfills")
      .insert({
        organization_id: fixture.orgId,
        rule_id: rule.id,
        filter: { documentTypeKey: "invoice" },
        created_by: fixture.user.userId
      })
      .select("*")
      .single();
    if (backfillError) throw backfillError;

    await setRuleBackfillControl(backfill.id, "running");
    const runStarted = Date.now();
    await enqueue(QUEUE_NAMES.backfillRule, { orgId: fixture.orgId, ruleBackfillId: backfill.id });

    const deadline = Date.now() + args.timeoutMinutes * 60 * 1000;
    let finalStatus: string | null = null;
    while (Date.now() < deadline) {
      const { data: row } = await admin
        .from("rule_backfills")
        .select("status, matched_count, applied_count")
        .eq("id", backfill.id)
        .single();
      if (row) {
        console.log(
          `status=${row.status} matched=${row.matched_count} applied=${row.applied_count} elapsed=${((Date.now() - runStarted) / 1000).toFixed(1)}s`
        );
        if (row.status === "completed" || row.status === "failed") {
          finalStatus = row.status;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    if (!finalStatus) {
      console.log(`did not finish within ${args.timeoutMinutes} minutes — a worker process must be running (npm run worker)`);
    } else {
      console.log(`backfill ${finalStatus} in ${((Date.now() - runStarted) / 1000).toFixed(1)}s`);
    }

    const { data: connections } = await admin
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", fixture.orgId)
      .eq("rule_backfill_id", backfill.id);
    console.log(`connections created: ${connections}`);
  }

  if (args.keep) {
    console.log(`kept fixture org=${fixture.orgId} user=${fixture.user.userId} rule=${rule.id}`);
  } else {
    const { deleteTestOrganization, deleteTestUser } = await import("../e2e/helpers/test-fixtures");
    await admin.from("documents").delete().eq("organization_id", fixture.orgId);
    await deleteTestOrganization(fixture.orgId);
    await deleteTestUser(fixture.user.userId);
    console.log("cleaned up fixture tenant");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
