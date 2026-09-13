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

// Milestone 5 (specs/05-level-1-structure.md §Document page). Bypasses the upload pipeline/
// worker entirely (that's e2e/documents.spec.ts's job) — creates the Paperless document and
// mirror row directly, so this only exercises getDocument()/getDocumentHistory()/the
// Connections panel/the preview route, which genuinely need a live Next.js request context
// (createClient() calls cookies()) and so can only be verified through the browser, not a
// standalone script.
test.describe("document detail page (needs a live Paperless instance)", () => {
  let user: TestUser;
  let organizationId: string;
  let documentId: string;
  let paperlessDocumentId: number;
  const uniqueName = `doc_detail_${Date.now()}`;

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    organizationId = await createTestOrganization(user.userId, `E2E Doc Detail ${Date.now()}`);
    await provisionTestOrganizationDirect(organizationId);

    const paperless = await paperlessFor(organizationId);
    const ownership = paperless.ownership;
    if (!ownership) throw new Error("expected tenant ownership");

    const form = new FormData();
    form.append(
      "document",
      new Blob([`Document detail e2e test.\n`], { type: "text/plain" }),
      `${uniqueName}.txt`
    );
    form.append("title", uniqueName);
    const rawTaskId = await paperless.postForm<string>("/api/documents/post_document/", form);
    const task = await pollPaperlessTask(paperless, parsePostDocumentTaskId(rawTaskId));
    if (task?.status !== "success" || !task.related_document_ids?.[0]) {
      throw new Error(`Test document did not finish consuming: ${JSON.stringify(task)}`);
    }
    paperlessDocumentId = task.related_document_ids[0];
    await paperless.setOwnedObjectPermissions(`/api/documents/${paperlessDocumentId}/`, ownership);

    const admin = createAdminClient();
    const { data: mirrorRow, error } = await admin
      .from("documents")
      .insert({
        organization_id: organizationId,
        paperless_document_id: paperlessDocumentId,
        title: uniqueName,
        status: "ready"
      })
      .select("id")
      .single();
    if (error) throw error;
    documentId = mirrorRow.id;
    await upsertDocumentObjectMap(admin, organizationId, paperlessDocumentId, documentId);
  });

  test.afterAll(async () => {
    const admin = createAdminClient();
    await admin.from("documents").delete().eq("id", documentId);
    await deleteTestOrganization(organizationId);
    await deleteTestUser(user.userId);
  });

  test("renders the document detail page with metadata and an empty connections state", async ({
    page
  }) => {
    await loginAsTestUser(page, user);
    await page.goto(`/dashboard/documents/${documentId}`);

    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();
    await expect(page.getByText("No connections yet.")).toBeVisible();

    // The PDF viewer <object> points at our own proxy route, never a raw Paperless URL.
    const objectEl = page.locator("object");
    await expect(objectEl).toHaveAttribute("data", `/api/documents/${documentId}/preview`);
  });

  test("returns 404 (via notFound()) for another organization's document id", async ({ page }) => {
    const otherUser = await createConfirmedTestUser();
    const otherOrgId = await createTestOrganization(otherUser.userId, `E2E Other Org ${Date.now()}`);
    await provisionTestOrganizationDirect(otherOrgId);

    try {
      await loginAsTestUser(page, otherUser);
      await page.goto(`/dashboard/documents/${documentId}`);
      await expect(page.getByText("Page not found")).toBeVisible();
    } finally {
      await deleteTestOrganization(otherOrgId);
      await deleteTestUser(otherUser.userId);
    }
  });

  test("the preview route streams the real file, authenticated by the session cookie", async ({
    page
  }) => {
    await loginAsTestUser(page, user);
    const response = await page.request.get(`/api/documents/${documentId}/preview`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-disposition"]).toContain("inline");
    const body = await response.text();
    expect(body).toContain("Document detail e2e test.");
  });
});
