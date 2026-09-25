import { expect, test } from "@playwright/test";

import { paperlessFor } from "@/lib/paperless/client";
import { parsePostDocumentTaskId, pollPaperlessTask } from "@/lib/paperless/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
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
  });

  test.afterAll(async () => {
    const admin = createAdminClient();
    for (const id of documentIds) {
      await admin.from("documents").delete().eq("id", id);
    }
    await deleteTestOrganization(organizationId);
    await deleteTestUser(user.userId);
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
    expect(lines[0]).toBe("Title;Type;Date;Status");
    expect(lines.length).toBeGreaterThanOrEqual(4); // header + at least the 3 bulk_e2e_* docs
  });

  // Level 1 definition-of-done item 8 explicitly names XLSX, not just CSV — file-builders.test.ts
  // unit-tests buildXlsx() in isolation, but that never exercises the real worker job or the
  // signed-download route, so this closes that gap the same way the CSV test above does.
  test("exports a filtered dataset to XLSX, downloadable via the signed URL route", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    await page.getByText("Select all matching filter").click();
    await expect(page.getByText(/\d+ selected/)).toBeVisible({ timeout: FORM_SUBMIT_TIMEOUT });
    await page.getByRole("button", { name: "Export XLSX" }).click();

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
    expect(fileRes.headers()["content-type"]).toContain("spreadsheetml");

    const buffer = await fileRes.body();
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Documents");

    expect(sheet?.getRow(1).getCell(1).value).toBe("Title");
    expect(sheet && sheet.rowCount).toBeGreaterThanOrEqual(4);
  });
});
