import { expect, test } from "@playwright/test";

import {
  createConfirmedTestUser,
  createTestOrganization,
  deleteTestOrganization,
  deleteTestUser,
  loginAsTestUser,
  provisionTestOrganization,
  type TestUser
} from "./helpers/test-fixtures";

// Smallest realistic PDF Paperless will actually consume — confirmed live: a 1x1 PNG with no
// DPI metadata gets rejected by Paperless's archive-PDF step ("no DPI information is present
// in this image and OCR_IMAGE_DPI is not set"), a real Paperless requirement for raw images,
// not something specific to this test. PDFs don't hit that path.
const PDF_TEXT = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 20 100 Td (e2e test) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;
const PDF_BYTES = Buffer.from(PDF_TEXT, "ascii");

test("redirects guests away from the documents dashboard to login", async ({ page }) => {
  await page.goto("/dashboard/documents");
  await expect(page).toHaveURL(/\/login/);
});

// Requires a real worker process consuming validate-upload -> submit-upload-to-paperless ->
// sync-paperless-document (`npm run worker:start`) and a real Paperless container, alongside
// the Playwright-managed dev server — CI doesn't wire the worker in yet (tracked separately,
// docs/IMPLEMENTATION_PLAN.md), so this only runs against a full local stack today.
test.describe("documents upload (needs a live worker + Paperless)", () => {
  let user: TestUser;
  let organizationId: string;

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    organizationId = await createTestOrganization(user.userId, `E2E Docs ${Date.now()}`);
    await provisionTestOrganization(organizationId);
  });

  test.afterAll(async () => {
    await deleteTestOrganization(organizationId);
    await deleteTestUser(user.userId);
  });

  test("logs in, uploads a document, and sees it processed end to end", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: "e2e-test.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES
    });
    await page.getByRole("button", { name: "Upload" }).click();

    await expect(page.getByText("e2e-test.pdf")).toBeVisible({ timeout: 15_000 });

    // The pipeline is genuinely async (validate -> submit-to-paperless -> sync) — poll for a
    // terminal status rather than assuming a fixed delay.
    await expect(async () => {
      await page.reload();
      const terminal = page.getByText(/^(ready|failed)$/);
      expect(await terminal.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 90_000, intervals: [3_000] });

    await expect(page.getByText("ready", { exact: true }).first()).toBeVisible();
  });
});
