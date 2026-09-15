import { expect, test } from "@playwright/test";

import { createAdminClient } from "@/lib/supabase/admin";
import { createConnection, getConnections } from "@/modules/connections/connections.service";
import { mergeEntities } from "@/modules/connections/entity-merge.service";
import { createEntity, listEntityIdentifiers } from "@/modules/entities/entities.service";
import { getEntityTypeByKey } from "@/modules/entity-types/entity-types.service";

import {
  createConfirmedTestUser,
  createTestOrganization,
  createUserClient,
  deleteTestOrganization,
  deleteTestUser,
  provisionTestOrganizationDirect,
  type TestUser
} from "./helpers/test-fixtures";

// specs/05-level-1-structure.md's Level 1 definition-of-done item 9: "Merge two duplicate
// customers without losing connections." merge_entities() (supabase/migrations/
// 20260914000000_entities_connections_fields_views.sql) checks auth.uid() itself, so this must
// run through a real RLS-scoped session (createUserClient), not the admin client — that's also
// why entity-merge.service.test.ts's mocked-db unit tests alone weren't enough to call this
// done: they never actually execute the Postgres function this whole feature depends on.
test.describe("entity merge (Level 1 definition-of-done item 9)", () => {
  let user: TestUser;
  let organizationId: string;

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    organizationId = await createTestOrganization(user.userId, `E2E Merge ${Date.now()}`);
    await provisionTestOrganizationDirect(organizationId);
  });

  test.afterAll(async () => {
    await deleteTestOrganization(organizationId);
    await deleteTestUser(user.userId);
  });

  test("merges a duplicate customer into another, keeping the connection and identifier", async () => {
    const userClient = await createUserClient(user);
    const ctx = { db: userClient, orgId: organizationId, actorId: user.userId, correlationId: "e2e-merge" };

    const customerType = await getEntityTypeByKey(ctx, "customer");
    const keep = await createEntity(ctx, { entityTypeId: customerType.id, displayName: "Acme d.o.o. (keep)" });
    const duplicate = await createEntity(ctx, {
      entityTypeId: customerType.id,
      displayName: "Acme Doo (duplicate)",
      data: { vat: "SI12345678" }
    });

    // A connection that exists only on the duplicate — must survive the merge, re-pointed to
    // the kept entity, per the spec's "without losing connections" requirement.
    const otherEntity = await createEntity(ctx, {
      entityTypeId: customerType.id,
      displayName: "Unrelated Third Party"
    });
    await createConnection(ctx, {
      sourceKind: "entity",
      sourceId: duplicate.id,
      targetKind: "entity",
      targetId: otherEntity.id
    });

    await mergeEntities(ctx, { keepId: keep.id, mergeId: duplicate.id });

    const admin = createAdminClient();
    const adminCtx = { db: admin, orgId: organizationId, actorId: null, correlationId: "e2e-merge-verify" };

    // The duplicate is archived + soft-deleted, never hard-deleted (spec: merges are reversible
    // in principle, and connections/audit history must still resolve the old id).
    const { data: mergedRow } = await admin
      .from("entities")
      .select("status, deleted_at")
      .eq("id", duplicate.id)
      .single();
    expect(mergedRow).toMatchObject({ status: "archived" });
    expect(mergedRow?.deleted_at).not.toBeNull();

    // The connection moved to the kept entity, not dropped.
    const keptConnections = await getConnections(adminCtx, "entity", keep.id);
    expect(keptConnections.some((c) => c.other.id === otherEntity.id)).toBe(true);

    const duplicateConnections = await getConnections(adminCtx, "entity", duplicate.id);
    expect(duplicateConnections).toHaveLength(0);

    // The identifier (VAT number) moved too, still resolvable for future import matching.
    const keptIdentifiers = await listEntityIdentifiers(adminCtx, keep.id);
    expect(keptIdentifiers.some((i) => i.normalized.includes("SI12345678"))).toBe(true);
  });
});
