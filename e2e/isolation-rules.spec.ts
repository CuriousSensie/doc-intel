import { expect, test } from "@playwright/test";

import { paperlessFor } from "@/lib/paperless/client";
import { parsePostDocumentTaskId, pollPaperlessTask } from "@/lib/paperless/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEntity } from "@/modules/entities/entities.service";
import { getEntityTypeByKey } from "@/modules/entity-types/entity-types.service";
import { buildDocumentSubjectContext } from "@/modules/rules/rules.context";
import { dispatchRuleActions } from "@/modules/rules/rules.dispatcher";
import { upsertDocumentObjectMap } from "@/modules/documents/sync-paperless-document";

import {
  createConfirmedTestUser,
  createTestOrganization,
  deleteTestOrganization,
  deleteTestUser,
  provisionTestOrganizationDirect,
  type TestUser
} from "./helpers/test-fixtures";

// specs/10-nonfunctional.md isolation test #10: "A's rule references B's entity" — Validation
// failure. Calls rules.dispatcher.ts directly against the admin client (same deliberately-weaker
// path as isolation-phase2.spec.ts — no RLS net — so a pass here proves the application-level
// ownership check itself, not just that RLS happened to catch what the app forgot). Also covers
// the real, session-found gap this test would have caught: resolveEntityRef()'s entity_ref-by-id
// case originally returned the id with no organization_id check at all (fixed this session,
// alongside a matching defense-in-depth check added to apply_rule_action() itself).
test.describe("tenant isolation — rules engine (specs/10-nonfunctional.md test 10)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let orgA: string;
  let orgB: string;
  let documentAId: string;
  let entityBId: string;
  const uniqueName = `isolation_rules_${Date.now()}`;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);

    userA = await createConfirmedTestUser();
    userB = await createConfirmedTestUser();
    orgA = await createTestOrganization(userA.userId, `Isolation Rules A ${Date.now()}`);
    orgB = await createTestOrganization(userB.userId, `Isolation Rules B ${Date.now()}`);
    await Promise.all([
      provisionTestOrganizationDirect(orgA),
      provisionTestOrganizationDirect(orgB)
    ]);

    const admin = createAdminClient();

    const paperless = await paperlessFor(orgA);
    const ownership = paperless.ownership;
    if (!ownership) throw new Error("expected tenant ownership");

    const title = `doc_a_${uniqueName}`;
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
      .insert({ organization_id: orgA, paperless_document_id: paperlessId, title, status: "ready" })
      .select("id")
      .single();
    if (error) throw error;
    documentAId = mirrorRow.id;
    await upsertDocumentObjectMap(admin, orgA, paperlessId, documentAId);

    const ctxB = { db: admin, orgId: orgB, actorId: null, correlationId: "e2e-setup" };
    const customerTypeB = await getEntityTypeByKey(ctxB, "customer");
    const entityB = await createEntity(ctxB, {
      entityTypeId: customerTypeB.id,
      displayName: `Isolation Rules Entity B ${uniqueName}`
    });
    entityBId = entityB.id;
  });

  test.afterAll(async () => {
    const admin = createAdminClient();
    await admin.from("documents").delete().eq("id", documentAId);
    await deleteTestOrganization(orgA);
    await deleteTestOrganization(orgB);
    await deleteTestUser(userA.userId);
    await deleteTestUser(userB.userId);
  });

  test("#10 A's rule referencing B's entity by id is rejected, not silently connected", async () => {
    const admin = createAdminClient();
    const ctxA = { db: admin, orgId: orgA, actorId: null, correlationId: "e2e-test-10" };

    const { data: ruleRow, error: ruleError } = await admin
      .from("rules")
      .insert({
        organization_id: orgA,
        name: `Isolation rule ${uniqueName}`,
        trigger: "manual",
        conditions: {},
        actions: [
          {
            type: "connect_entity",
            entity_ref: { by: "id", entityId: entityBId },
            relation: "issued_to"
          }
        ]
      })
      .select("*")
      .single();
    if (ruleError) throw ruleError;

    const { data: ruleRun, error: ruleRunError } = await admin
      .from("rule_runs")
      .insert({
        organization_id: orgA,
        rule_id: ruleRow.id,
        document_id: documentAId,
        trigger: "manual",
        matched: true
      })
      .select("id")
      .single();
    if (ruleRunError) throw ruleRunError;

    const subject = await buildDocumentSubjectContext(ctxA, documentAId);
    const outcomes = await dispatchRuleActions(ctxA, ruleRow, ruleRun.id, subject, new Map());

    // resolveEntityRef() can't resolve B's entity from A's org — dispatch reports it as
    // unresolvable, not as a rejected/errored write.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("skipped_entity_not_found");

    // No connection leaked into A's org referencing B's entity id, from either the dispatcher's
    // own guard or apply_rule_action()'s independent ownership check.
    const { data: leaked } = await admin
      .from("connections")
      .select("id")
      .eq("organization_id", orgA)
      .eq("target_id", entityBId);
    expect(leaked ?? []).toHaveLength(0);
  });
});
