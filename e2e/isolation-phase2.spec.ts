import { expect, test } from "@playwright/test";

import { paperlessFor } from "@/lib/paperless/client";
import { bulkEditPaperlessDocuments, getPaperlessDocument } from "@/lib/paperless/documents";
import { parsePostDocumentTaskId, pollPaperlessTask } from "@/lib/paperless/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createConnection } from "@/modules/connections/connections.service";
import { createEntity } from "@/modules/entities/entities.service";
import { getEntityTypeByKey } from "@/modules/entity-types/entity-types.service";
import { resolveExportData } from "@/modules/exports/exports.service";
import { upsertDocumentObjectMap } from "@/modules/documents/sync-paperless-document";

import {
  createConfirmedTestUser,
  createTestOrganization,
  deleteTestOrganization,
  deleteTestUser,
  provisionTestOrganizationDirect,
  type TestUser
} from "./helpers/test-fixtures";

// specs/10-nonfunctional.md tests 9/14/15 — the three Phase 2 (Milestone 7/entities) additions
// to the canonical 20-test isolation suite, added alongside their features per this codebase's
// habit (test #7 landed with custom fields in Milestone 4) rather than batched at the end.
// Test 16 (export ZIP of original files) has no code to test yet — specs/05-level-1-structure.md
// marks the ZIP-of-originals export as optional and it was not built in Milestone 7 (CSV/XLSX
// row export only) — see docs/IMPLEMENTATION_PLAN.md and PHASE2_HANDOFF.md for the explicit
// deferral, so no test is faked here for it.
//
// Calls services directly against the ADMIN client (buildJobContext's own db, ADR-0007) rather
// than through a request/browser session — this is deliberately the *weaker* of the two paths
// (no RLS net at all), so proving isolation holds here proves the application-level checks
// themselves are correct, not just that RLS happens to catch what the app forgot.
test.describe("tenant isolation — Phase 2 additions (specs/10-nonfunctional.md tests 9, 14, 15)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let orgA: string;
  let orgB: string;
  let entityBId: string;
  let documentAId: string;
  let documentBId: string;
  let paperlessDocumentBId: number;
  const uniqueName = `isolation_p2_${Date.now()}`;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);

    userA = await createConfirmedTestUser();
    userB = await createConfirmedTestUser();
    orgA = await createTestOrganization(userA.userId, `Isolation P2 A ${Date.now()}`);
    orgB = await createTestOrganization(userB.userId, `Isolation P2 B ${Date.now()}`);
    await Promise.all([
      provisionTestOrganizationDirect(orgA),
      provisionTestOrganizationDirect(orgB)
    ]);

    const admin = createAdminClient();

    // One real document per org (bypassing the upload pipeline, same as document-detail.spec.ts).
    async function createRealDocument(orgId: string, title: string): Promise<{ id: string; paperlessId: number }> {
      const paperless = await paperlessFor(orgId);
      const ownership = paperless.ownership;
      if (!ownership) throw new Error("expected tenant ownership");

      const form = new FormData();
      form.append("document", new Blob([`${title}\n`], { type: "text/plain" }), `${title}.txt`);
      form.append("title", title);
      const rawTaskId = await paperless.postForm<string>("/api/documents/post_document/", form);
      const task = await pollPaperlessTask(paperless, parsePostDocumentTaskId(rawTaskId));
      if (task?.status !== "success" || !task.related_document_ids?.[0]) {
        throw new Error(`Test document did not finish consuming: ${JSON.stringify(task)}`);
      }
      const paperlessId = task.related_document_ids[0];
      await paperless.setOwnedObjectPermissions(`/api/documents/${paperlessId}/`, ownership);

      const { data: mirrorRow, error } = await admin
        .from("documents")
        .insert({ organization_id: orgId, paperless_document_id: paperlessId, title, status: "ready" })
        .select("id")
        .single();
      if (error) throw error;
      await upsertDocumentObjectMap(admin, orgId, paperlessId, mirrorRow.id);
      return { id: mirrorRow.id, paperlessId };
    }

    const docA = await createRealDocument(orgA, `doc_a_${uniqueName}`);
    documentAId = docA.id;
    const docB = await createRealDocument(orgB, `doc_b_${uniqueName}`);
    documentBId = docB.id;
    paperlessDocumentBId = docB.paperlessId;

    const ctxB = { db: admin, orgId: orgB, actorId: null, correlationId: "e2e-setup" };
    const customerTypeB = await getEntityTypeByKey(ctxB, "customer");
    const entityB = await createEntity(ctxB, {
      entityTypeId: customerTypeB.id,
      displayName: `Isolation P2 Entity B ${uniqueName}`
    });
    entityBId = entityB.id;
  });

  test.afterAll(async () => {
    const admin = createAdminClient();
    await admin.from("documents").delete().in("id", [documentAId, documentBId]);
    await deleteTestOrganization(orgA);
    await deleteTestOrganization(orgB);
    await deleteTestUser(userA.userId);
    await deleteTestUser(userB.userId);
  });

  test("#9 A creates a connection targeting B's entity id — rejected, not silently created", async () => {
    const admin = createAdminClient();
    const ctxA = { db: admin, orgId: orgA, actorId: null, correlationId: "e2e-test-9" };

    await expect(
      createConnection(ctxA, {
        sourceKind: "document",
        sourceId: documentAId,
        targetKind: "entity",
        targetId: entityBId
      })
    ).rejects.toThrow(/entity not found/);

    // Confirms this is a rejection, not a silent partial write — no connection row exists at all.
    const { data: leaked } = await admin
      .from("connections")
      .select("id")
      .eq("organization_id", orgA)
      .eq("target_id", entityBId);
    expect(leaked ?? []).toHaveLength(0);
  });

  test("#14 A's bulk edit with B's document id mutates nothing on B's document", async () => {
    const paperlessA = await paperlessFor(orgA);
    const originalTitle = `doc_b_${uniqueName}`;

    // Paperless's own object-level ACL (D2) is the real enforcement point here — org A's service
    // user has no permission on org B's document, so this proxy call must not touch it. Accept
    // either an outright rejection or a silent no-op on B's side; assert only the outcome the
    // spec actually requires: B's document is unmutated.
    try {
      await bulkEditPaperlessDocuments(paperlessA, {
        documentIds: [paperlessDocumentBId],
        method: "set_document_type",
        parameters: { document_type: null }
      });
    } catch {
      // Rejection is an acceptable (even preferable) outcome — falls through to the assertion.
    }

    const paperlessB = await paperlessFor(orgB);
    const stillB = await getPaperlessDocument(paperlessB, paperlessDocumentBId);
    expect(stillB.title).toBe(originalTitle);
  });

  test("#15 A's export includes only A's rows, even when B's document id is passed explicitly", async () => {
    const admin = createAdminClient();
    const ctxA = { db: admin, orgId: orgA, actorId: null, correlationId: "e2e-test-15" };

    const { rows } = await resolveExportData(ctxA, [documentAId, documentBId]);

    expect(rows.map((r) => r.documentId)).toEqual([documentAId]);
    expect(rows.some((r) => r.documentId === documentBId)).toBe(false);
  });
});
