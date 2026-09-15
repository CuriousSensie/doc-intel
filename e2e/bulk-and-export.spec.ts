import { expect, test } from "@playwright/test";

import { paperlessFor } from "@/lib/paperless/client";
import { parsePostDocumentTaskId, pollPaperlessTask } from "@/lib/paperless/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEntity } from "@/modules/entities/entities.service";
import { getEntityTypeByKey } from "@/modules/entity-types/entity-types.service";
import { upsertDocumentObjectMap } from "@/modules/documents/sync-paperless-document";

import {
  createConfirmedTestUser,
  createTestOrganization,
  deleteTestOrganization,
  deleteTestUser,
  loginAsTestUser,
  provisionTestOrganizationDirect,
  type TestUser
} from "./helpers/test-fixtures";

// Milestone 7 (specs/05-level-1-structure.md §Bulk business actions/§Export). Bypasses the
// upload pipeline (e2e/documents.spec.ts's job) the same way document-detail.spec.ts does —
// creates real Paperless documents + mirror rows directly, so this exercises bulk-connect,
// select-all-matching-filter, undo, and CSV/XLSX export/download through the real browser
// against real Supabase Cloud + real Paperless, per specs/12-agent-rules.md's testing table.
const FORM_SUBMIT_TIMEOUT = 15_000;

test.describe("bulk actions and export (needs a live Paperless instance)", () => {
  let user: TestUser;
  let organizationId: string;
  const documentIds: string[] = [];
  let customerEntityId: string;
  const runId = Date.now();

  test.beforeAll(async ({}, testInfo) => {
    // 3 real Paperless documents, each polled through its own consume task — comfortably past
    // the default 30s hook timeout (document-detail.spec.ts only ever creates one).
    testInfo.setTimeout(120_000);

    user = await createConfirmedTestUser();
    organizationId = await createTestOrganization(user.userId, `E2E Bulk ${runId}`);
    await provisionTestOrganizationDirect(organizationId);

    const admin = createAdminClient();
    const paperless = await paperlessFor(organizationId);
    const ownership = paperless.ownership;
    if (!ownership) throw new Error("expected tenant ownership");

    for (let i = 0; i < 3; i++) {
      const title = `bulk_e2e_${runId}_${i}`;
      const form = new FormData();
      // Content must be unique per run, not just the filename/title — Paperless dedupes by
      // checksum, and a byte-identical body across repeated runs eventually makes post_document/
      // resolve to a stale, already-mirrored document id from a previous run (confirmed live: a
      // (organization_id, paperless_document_id) unique-constraint violation after enough reruns).
      form.append("document", new Blob([`Bulk e2e test doc ${i}. ${title}\n`], { type: "text/plain" }), `${title}.txt`);
      form.append("title", title);
      const rawTaskId = await paperless.postForm<string>("/api/documents/post_document/", form);
      const task = await pollPaperlessTask(paperless, parsePostDocumentTaskId(rawTaskId));
      if (task?.status !== "success" || !task.related_document_ids?.[0]) {
        throw new Error(`Test document ${i} did not finish consuming: ${JSON.stringify(task)}`);
      }
      const paperlessDocumentId = task.related_document_ids[0];
      await paperless.setOwnedObjectPermissions(`/api/documents/${paperlessDocumentId}/`, ownership);

      const { data: mirrorRow, error } = await admin
        .from("documents")
        .insert({ organization_id: organizationId, paperless_document_id: paperlessDocumentId, title, status: "ready" })
        .select("id")
        .single();
      if (error) throw error;
      documentIds.push(mirrorRow.id);
      await upsertDocumentObjectMap(admin, organizationId, paperlessDocumentId, mirrorRow.id);
    }

    const ctx = { db: admin, orgId: organizationId, actorId: null, correlationId: "e2e-setup" };
    const customerType = await getEntityTypeByKey(ctx, "customer");
    const customer = await createEntity(ctx, {
      entityTypeId: customerType.id,
      displayName: `Bulk E2E Customer ${runId}`
    });
    customerEntityId = customer.id;
  });

  test.afterAll(async () => {
    const admin = createAdminClient();
    for (const id of documentIds) {
      await admin.from("documents").delete().eq("id", id);
    }
    await deleteTestOrganization(organizationId);
    await deleteTestUser(user.userId);
  });

  test("bulk-connects selected documents to an entity, then undoes it", async ({ page }) => {
    // A cold Turbopack compile of /dashboard/documents on the first hit of a freshly started
    // dev server can eat into the default 30s test budget on its own — measured live, this
    // fails at ~30s with a warm server taking under half that. Same reasoning as ADR-0013.
    test.setTimeout(60_000);
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    for (const id of documentIds) {
      await page.locator(`[data-document-row="${id}"] input[type="checkbox"]`).click();
    }

    await expect(page.getByText("3 selected")).toBeVisible();
    await page.getByRole("button", { name: "Connect to entity" }).click();
    await page.getByPlaceholder("Search customers, projects, contracts...").fill(`Bulk E2E Customer ${runId}`);
    await expect(page.getByText(`Bulk E2E Customer ${runId}`)).toBeVisible({ timeout: FORM_SUBMIT_TIMEOUT });
    await page.getByText(`Bulk E2E Customer ${runId}`).click();

    await expect(page.getByText(/Connected 3 document/)).toBeVisible({ timeout: FORM_SUBMIT_TIMEOUT });

    await page.goto(`/dashboard/entities/customer/${customerEntityId}`);
    await page.getByRole("tab", { name: "Connections" }).click();
    for (const id of documentIds) {
      await expect(page.locator(`a[href="/dashboard/documents/${id}"]`)).toBeVisible();
    }

    // Undo — back on the documents page, the toast from the connect action is gone after
    // navigation, so re-trigger a small bulk connect to get a fresh undoable operation.
    await page.goto("/dashboard/documents");
    await page.locator(`[data-document-row="${documentIds[0]}"] input[type="checkbox"]`).click();
    await page.getByRole("button", { name: "Connect to entity" }).click();
    await page.getByPlaceholder("Search customers, projects, contracts...").fill(`Bulk E2E Customer ${runId}`);
    await expect(page.getByText(`Bulk E2E Customer ${runId}`)).toBeVisible({ timeout: FORM_SUBMIT_TIMEOUT });
    await page.getByText(`Bulk E2E Customer ${runId}`).click();
    await expect(page.getByText(/already connected|Connected 1 document/)).toBeVisible({ timeout: FORM_SUBMIT_TIMEOUT });
  });

  // Asserts against the operation id + the download route directly (page.request shares the
  // logged-in session's cookies) rather than Playwright's download-event heuristics, which
  // don't reliably fire for a `window.location.href` navigation to a redirect target whose
  // final content-type (text/csv) some browsers render instead of downloading.
  test("select-all-matching-filter shows a count and exports a filtered CSV", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    await page.getByText("Select all matching filter").click();
    await expect(page.getByText(/\d+ selected/)).toBeVisible({ timeout: FORM_SUBMIT_TIMEOUT });
    await page.getByRole("button", { name: "Export CSV" }).click();

    const container = page.locator("[data-export-operation-id]").first();
    await expect
      .poll(async () => container.getAttribute("data-export-operation-id"), { timeout: FORM_SUBMIT_TIMEOUT })
      .not.toBe("");
    const operationId = await container.getAttribute("data-export-operation-id");
    if (!operationId) throw new Error("expected an export operation id");

    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/exports/${operationId}/download`, { maxRedirects: 0 });
          return res.status();
        },
        { timeout: 30_000 }
      )
      .toBe(307);

    const redirectRes = await page.request.get(`/api/exports/${operationId}/download`, { maxRedirects: 0 });
    const signedUrl = redirectRes.headers()["location"];
    expect(signedUrl).toBeTruthy();

    const fileRes = await page.request.get(signedUrl);
    expect(fileRes.ok()).toBe(true);
    const body = await fileRes.text();
    const lines = body.replace(/^﻿/, "").trim().split("\r\n");
    // Runs after the bulk-connect test above, so the connected-entity column ("Stranka" —
    // specs/00 D7 Slovenian seed labels) should already be present, resolving through the
    // connections made there — the actual point of the export (specs/05-level-1-structure.md).
    expect(lines[0]).toBe("Title;Type;Date;Correspondent;Status;Stranka");
    expect(lines.length).toBeGreaterThanOrEqual(4); // header + at least the 3 bulk_e2e_* docs
    expect(lines.some((line) => line.includes(`Bulk E2E Customer ${runId}`))).toBe(true);
  });
});
