import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { paperlessFor } from "@/lib/paperless/client";
import { parsePostDocumentTaskId, pollPaperlessTask } from "@/lib/paperless/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeIdentifier } from "@/modules/entities/identifier-normalization";
import { validateImportJob } from "@/modules/imports/imports.service";
import { upsertDocumentObjectMap } from "@/modules/documents/sync-paperless-document";

import {
  createConfirmedTestUser,
  createTestOrganization,
  createUserClient,
  deleteTestOrganization,
  deleteTestUser,
  provisionTestOrganizationDirect,
  type TestUser
} from "./helpers/test-fixtures";

// specs/10-nonfunctional.md's canonical 20-test tenant-isolation suite, tests 1-8 and 17-20 —
// the subset not blocked on features later phases build (connections/rules/import/AI/bulk-edit/
// export, tests 9-11/13-16, and saved views, test 12, tracked separately). Manually run once
// against a live instance as scripts/spike/isolation.ts (docs/spike-findings.md §1); this lifts
// those checks into a permanent, real spec — real two tenants, real Paperless, real Supabase,
// no mocks, using the actual production client (paperlessFor(), createOwnedObject()) rather
// than the spike's standalone hand-rolled helpers.
//
// Unlike e2e/documents.spec.ts, this needs no worker process — every check here (tenant setup,
// Paperless object creation, all assertions) runs directly in this process, so
// provisionTestOrganizationDirect() is the right fixture (not provisionTestOrganization(), which
// exists specifically for specs that also need a separate worker container to agree on the same
// Paperless base_url). Does need a real Paperless instance reachable at PAPERLESS_ADMIN_URL.
test.describe("tenant isolation (specs/10-nonfunctional.md, tests 1-8 & 17-20)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let orgA: string;
  let orgB: string;
  let documentId: number | null = null;
  let tagId: number;
  let docTypeId: number;
  let correspondentId: number;
  let storagePathId: number;
  let customFieldId: number;
  let customFieldValue: string;
  const uniqueName = `isolation_${Date.now()}`;
  const secretString = `SECRET_TENANT_A_${uniqueName}`;

  test.beforeAll(async () => {
    userA = await createConfirmedTestUser();
    userB = await createConfirmedTestUser();
    orgA = await createTestOrganization(userA.userId, `Isolation A ${Date.now()}`);
    orgB = await createTestOrganization(userB.userId, `Isolation B ${Date.now()}`);
    await Promise.all([
      provisionTestOrganizationDirect(orgA),
      provisionTestOrganizationDirect(orgB)
    ]);

    const paperlessA = await paperlessFor(orgA);
    const ownershipA = paperlessA.ownership;
    if (!ownershipA) throw new Error("Expected a tenant client to carry ownership");

    // One object per class as tenant A, via the real createOwnedObject() — this also is test
    // #20's positive path: these only succeed because the permissions we pass match the
    // client's own ownership.
    tagId = (
      await paperlessA.createOwnedObject<{ id: number }>(
        "/api/tags/",
        { name: `tag_${uniqueName}` },
        ownershipA
      )
    ).id;
    docTypeId = (
      await paperlessA.createOwnedObject<{ id: number }>(
        "/api/document_types/",
        { name: `doctype_${uniqueName}` },
        ownershipA
      )
    ).id;
    correspondentId = (
      await paperlessA.createOwnedObject<{ id: number }>(
        "/api/correspondents/",
        { name: `correspondent_${uniqueName}` },
        ownershipA
      )
    ).id;
    storagePathId = (
      await paperlessA.createOwnedObject<{ id: number }>(
        "/api/storage_paths/",
        { name: `storagepath_${uniqueName}`, path: `{{ created }}/${uniqueName}` },
        ownershipA
      )
    ).id;
    customFieldId = (
      await paperlessA.createOwnedObject<{ id: number }>(
        "/api/custom_fields/",
        { name: `customfield_${uniqueName}`, data_type: "string" },
        ownershipA
      )
    ).id;

    // One document as tenant A, containing a string unique to this run (test #4's full-text
    // search check) — same postForm()/pollPaperlessTask() path submit-upload-to-paperless.ts
    // uses in production.
    const form = new FormData();
    form.append(
      "document",
      new Blob([`Isolation test document.\n${secretString}\n`], { type: "text/plain" }),
      `${uniqueName}.txt`
    );
    form.append("title", `doc_${uniqueName}`);
    const rawTaskId = await paperlessA.postForm<string>("/api/documents/post_document/", form);
    const task = await pollPaperlessTask(paperlessA, parsePostDocumentTaskId(rawTaskId));
    if (task?.status !== "success" || !task.related_document_ids?.[0]) {
      throw new Error(`Test document did not finish consuming: ${JSON.stringify(task)}`);
    }
    documentId = task.related_document_ids[0];

    // post_document/ doesn't itself grant the tenant group view/change (docs/spike-findings.md)
    // — the same PATCH submit-upload-to-paperless.ts does in production.
    await paperlessA.setOwnedObjectPermissions(`/api/documents/${documentId}/`, ownershipA);

    // A real custom field VALUE on A's document — test #7 (below) is the still-open question
    // docs/spike-findings.md §1 flagged: definitions leak (#6, confirmed), but do values leak
    // too? Unlike definitions we don't mirror values locally, so if this leaks it's a deeper,
    // unmitigated hole.
    customFieldValue = `secret_value_${uniqueName}`;
    await paperlessA.patch(`/api/documents/${documentId}/`, {
      custom_fields: [{ field: customFieldId, value: customFieldValue }]
    });
  });

  test.afterAll(async () => {
    await deleteTestOrganization(orgA);
    await deleteTestOrganization(orgB);
    await deleteTestUser(userA.userId);
    await deleteTestUser(userB.userId);
  });

  test("#1 B lists documents — does not include A's", async () => {
    const paperlessB = await paperlessFor(orgB);
    const data = await paperlessB.get<{ results: Array<{ id: number }> }>("/api/documents/");
    expect(data.results.some((d) => d.id === documentId)).toBe(false);
  });

  test("#3 B fetches A's document by id — 404", async () => {
    const paperlessB = await paperlessFor(orgB);
    await expect(paperlessB.get(`/api/documents/${documentId}/`)).rejects.toThrow();
  });

  test("#4 B full-text searches for A's unique string — 0 results", async () => {
    const paperlessB = await paperlessFor(orgB);
    const data = await paperlessB.get<{ results: Array<{ id: number }> }>(
      `/api/documents/?query=${encodeURIComponent(secretString)}`
    );
    expect(data.results).toHaveLength(0);
  });

  test("#5 B lists tags/document types/correspondents/storage paths — none of A's", async () => {
    const paperlessB = await paperlessFor(orgB);
    const classes: Array<[string, number]> = [
      ["/api/tags/", tagId],
      ["/api/document_types/", docTypeId],
      ["/api/correspondents/", correspondentId],
      ["/api/storage_paths/", storagePathId]
    ];
    for (const [path, createdId] of classes) {
      const data = await paperlessB.get<{ results: Array<{ id: number }> }>(path);
      expect(data.results.some((o) => o.id === createdId)).toBe(false);
    }
  });

  test("#6 B lists custom field definitions — none of A's (known Paperless leak)", async () => {
    // docs/spike-findings.md §1's confirmed finding: this leaks on the pinned version even with
    // owner/set_permissions correctly set — contained by never querying this endpoint directly
    // from product code (custom_field_defs mirror only, Phase 2). test.fail() (not an inverted
    // assertion) so this tracks the real, still-open leak without permanently failing CI: if
    // Paperless ever fixes it upstream, this test starts *unexpectedly passing*, which Playwright
    // flags loudly — the signal to come back and remove this annotation, not something that
    // silently goes green and gets forgotten.
    test.fail();
    const paperlessB = await paperlessFor(orgB);
    const data = await paperlessB.get<{ results: Array<{ id: number }> }>("/api/custom_fields/");
    expect(data.results.some((o) => o.id === customFieldId)).toBe(false);
  });

  test("#7 B reads a custom field value on A's document — 404", async () => {
    // specs/10-nonfunctional.md test #7 — docs/spike-findings.md §1 flagged this as
    // high-priority for Phase 2's first pass: #6 confirmed definitions leak, but values are
    // riskier since we never mirror them locally and rely entirely on Paperless's own
    // per-document ACL. Two angles, since Paperless embeds values inline on the document
    // object rather than exposing a separate value endpoint:
    const paperlessB = await paperlessFor(orgB);

    // (a) the same per-document 404 test #3 already exercises, now with a real value attached
    // — proving a populated custom_fields array creates no alternate access path.
    await expect(paperlessB.get(`/api/documents/${documentId}/`)).rejects.toThrow();

    // (b) B knows customFieldId is a real field (the leaked list from #6) — filtering the
    // document list by that field's value must not surface A's document either, which is the
    // "deeper leak" the spike explicitly worried about: a curious tenant using a definition id
    // leaked via #6 to go fishing for values across tenants.
    const query = encodeURIComponent(JSON.stringify([customFieldId, "exact", customFieldValue]));
    const data = await paperlessB.get<{ results: Array<{ id: number }> }>(
      `/api/documents/?custom_field_query=${query}`
    );
    expect(data.results.some((d) => d.id === documentId)).toBe(false);
  });

  test("#8 B downloads A's document by direct URL — denied", async () => {
    const paperlessB = await paperlessFor(orgB);
    // docs/spike-findings.md's confirmed finding: cross-tenant download returns 403, not 404 —
    // still a denial either way, which is what this test actually asserts.
    await expect(paperlessB.get(`/api/documents/${documentId}/download/`)).rejects.toThrow();
  });

  test("#17 B's global search for A's unique string — 0 results", async () => {
    const paperlessB = await paperlessFor(orgB);
    let data: { documents?: Array<{ id: number }> } | Array<{ id: number }>;
    try {
      data = await paperlessB.get(`/api/search/?query=${encodeURIComponent(secretString)}`);
    } catch {
      test.skip(true, "No /api/search/ endpoint on this Paperless version");
      return;
    }
    const list = Array.isArray(data) ? data : (data.documents ?? []);
    expect(list.some((o) => o.id === documentId)).toBe(false);
  });

  test("#18 B cannot download A's upload by guessing its storage path", async () => {
    // Confirms 20260822090000_files_storage.sql/20260828000000_document_uploads.sql's own
    // design note: "No storage.objects RLS policies... the resulting URL's own token is what
    // authorizes the browser's direct PUT" — a private bucket with zero grants for
    // `authenticated`, so simply knowing another org's object key must not be enough.
    const admin = createAdminClient();
    const path = `${orgA}/${randomUUID()}-guessed.pdf`;
    await admin.storage.from("document-uploads").upload(path, Buffer.from("not a real upload"));

    const userBClient = await createUserClient(userB);
    const { data, error } = await userBClient.storage.from("document-uploads").download(path);
    expect(data).toBeNull();
    expect(error).not.toBeNull();

    await admin.storage.from("document-uploads").remove([path]);
  });

  test("#19 reconciliation does not adopt another org's mapped document", async () => {
    // Paperless's own ACL already stops org B from ever discovering org A's document through
    // normal listing/search (tests #1-8 above) — the only way to exercise this guard is to call
    // it directly with a paperless_id another org has already claimed, simulating what would
    // happen if that first line of defense ever failed.
    const admin = createAdminClient();
    const fakePaperlessId = -Math.floor(Date.now() / 1000); // negative, guaranteed not a real Paperless id
    await upsertDocumentObjectMap(admin, orgA, fakePaperlessId, randomUUID());

    await expect(
      upsertDocumentObjectMap(admin, orgB, fakePaperlessId, randomUUID())
    ).rejects.toThrow(/already mapped to org/);

    await admin
      .from("paperless_object_map")
      .delete()
      .eq("object_type", "document")
      .eq("paperless_id", fakePaperlessId);
  });

  test("#11 A's import cannot map to B's entity identifier", async () => {
    const admin = createAdminClient();
    const [customerTypeA, customerTypeB] = await Promise.all(
      [orgA, orgB].map(async (organizationId) => {
        const { data, error } = await admin
          .from("entity_types")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("key", "customer")
          .single();
        if (error) throw error;
        return data;
      })
    );

    const leakedVat = `SI${Date.now().toString().slice(-8)}`;
    const { data: entityB, error: entityError } = await admin
      .from("entities")
      .insert({
        organization_id: orgB,
        entity_type_id: customerTypeB.id,
        display_name: `Tenant B Customer ${uniqueName}`,
        data: { vat: leakedVat },
        created_by: userB.userId
      })
      .select("id")
      .single();
    if (entityError) throw entityError;

    const { error: identifierError } = await admin.from("entity_identifiers").insert({
      organization_id: orgB,
      entity_id: entityB.id,
      kind: "vat",
      value: leakedVat,
      normalized: normalizeIdentifier("vat", leakedVat)
    });
    if (identifierError) throw identifierError;

    const { data: documentA, error: documentError } = await admin
      .from("documents")
      .insert({
        organization_id: orgA,
        paperless_document_id: -Math.floor(Date.now() / 1000),
        title: `tenant-a-import-target-${uniqueName}`,
        status: "ready",
        source: "import",
        created_by: userA.userId
      })
      .select("id,title")
      .single();
    if (documentError) throw documentError;

    const { data: importJob, error: jobError } = await admin
      .from("import_jobs")
      .insert({
        organization_id: orgA,
        kind: "metadata_only",
        created_by: userA.userId,
        status: "mapping",
        source_filename: "tenant-a-metadata.csv",
        mapping: {
          documentBy: { strategy: "filename", column: 0 },
          fields: [],
          entityLinks: [
            {
              entityTypeKey: "customer",
              matchBy: "identifier",
              identifierKind: "vat",
              column: 1,
              relation: "issued_to",
              onMissing: "fail_row"
            }
          ]
        }
      })
      .select("id")
      .single();
    if (jobError) throw jobError;

    const { error: rowError } = await admin.from("import_rows").insert({
      organization_id: orgA,
      import_job_id: importJob.id,
      row_number: 1,
      raw: [documentA.title, leakedVat]
    });
    if (rowError) throw rowError;

    const userAClient = await createUserClient(userA);
    const summary = await validateImportJob(
      {
        db: userAClient,
        orgId: orgA,
        actorId: userA.userId,
        correlationId: `iso-11-${uniqueName}`
      },
      importJob.id
    );
    expect(summary).toEqual({
      ok: 0,
      skippedDuplicate: 0,
      needsReview: 0,
      failed: 1,
      unmatched: 1
    });

    const { data: row, error: validatedRowError } = await admin
      .from("import_rows")
      .select("status, error_code")
      .eq("import_job_id", importJob.id)
      .single();
    if (validatedRowError) throw validatedRowError;
    expect(row).toEqual({ status: "failed", error_code: "ENTITY_NOT_FOUND" });

    const { count, error: connectionError } = await admin
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgA)
      .eq("source_kind", "document")
      .eq("source_id", documentA.id)
      .eq("target_kind", "entity")
      .eq("target_id", entityB.id);
    if (connectionError) throw connectionError;
    expect(count).toBe(0);
    expect(customerTypeA.id).not.toBe(customerTypeB.id);
  });

  test("#20 creating a Paperless object without matching permissions is refused", async () => {
    const paperlessA = await paperlessFor(orgA);
    await expect(
      paperlessA.createOwnedObject(
        "/api/tags/",
        { name: `should_never_exist_${uniqueName}` },
        { ownerId: 999_999_999, groupId: 999_999_999 }
      )
    ).rejects.toThrow(/Refusing to grant/);
  });
});
