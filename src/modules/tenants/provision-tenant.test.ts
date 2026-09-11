import { beforeAll, describe, expect, it } from "vitest";

// Real Paperless, not mocked (specs/12-agent-rules.md) — same instance CI's e2e job starts
// before running this file (`npm test -- src/lib/paperless src/modules/tenants`).
let paperlessAdminClient: (typeof import("@/lib/paperless/client"))["paperlessAdminClient"];
let findOrCreateGroup: (typeof import("./provision-tenant"))["findOrCreateGroup"];
let findOrCreateServiceUser: (typeof import("./provision-tenant"))["findOrCreateServiceUser"];
let findOrCreateDocumentType: (typeof import("./provision-tenant"))["findOrCreateDocumentType"];
let findOrCreateStoragePath: (typeof import("./provision-tenant"))["findOrCreateStoragePath"];

beforeAll(async () => {
  const clientMod = await import("@/lib/paperless/client");
  const provisionMod = await import("./provision-tenant");
  paperlessAdminClient = clientMod.paperlessAdminClient;
  findOrCreateGroup = provisionMod.findOrCreateGroup;
  findOrCreateServiceUser = provisionMod.findOrCreateServiceUser;
  findOrCreateDocumentType = provisionMod.findOrCreateDocumentType;
  findOrCreateStoragePath = provisionMod.findOrCreateStoragePath;
});

// Needs a real reachable Paperless instance — runs in CI's dedicated "Paperless client
// contract tests" step (Paperless started first), skips in a plain `npm test` with no infra
// up, same as the rest of the "checks" job expects.
const hasLivePaperless = Boolean(process.env.PAPERLESS_ADMIN_URL);

describe.skipIf(!hasLivePaperless)("provisionTenant's Paperless-side steps", () => {
  it("find-or-create is idempotent for group, service user, document type, and storage path", async () => {
    const admin = await paperlessAdminClient();
    const orgId = `test_${Date.now()}`;

    const groupId1 = await findOrCreateGroup(admin, orgId);
    const groupId2 = await findOrCreateGroup(admin, orgId);
    expect(groupId2).toBe(groupId1);

    const { userId: userId1, token: token1 } = await findOrCreateServiceUser(
      admin,
      orgId,
      groupId1
    );
    const { userId: userId2, token: token2 } = await findOrCreateServiceUser(
      admin,
      orgId,
      groupId1
    );
    expect(userId2).toBe(userId1);
    // The retry resets the password and re-logs-in — confirm the resulting token actually
    // authenticates, not just that a string came back.
    expect(token2).toBeTruthy();
    const authRes = await fetch("http://localhost:8010/api/tags/", {
      headers: { Authorization: `Token ${token2}` }
    });
    expect(authRes.status).toBe(200);
    void token1;

    const docTypeName = `TestType_${orgId}`;
    const docTypeId1 = await findOrCreateDocumentType(admin, docTypeName, userId1, groupId1);
    const docTypeId2 = await findOrCreateDocumentType(admin, docTypeName, userId1, groupId1);
    expect(docTypeId2).toBe(docTypeId1);

    const storagePathId1 = await findOrCreateStoragePath(admin, userId1, groupId1);
    const storagePathId2 = await findOrCreateStoragePath(admin, userId1, groupId1);
    expect(storagePathId2).toBe(storagePathId1);

    // Cleanup — this test creates real Paperless objects.
    await admin.delete(`/api/document_types/${docTypeId1}/`);
    await admin.delete(`/api/users/${userId1}/`);
    await admin.delete(`/api/groups/${groupId1}/`);
    // The Default storage path is shared across test runs by design (name__iexact lookup) —
    // never delete it here, another run or a real provisioned tenant may depend on it.
  }, 30000);
});
