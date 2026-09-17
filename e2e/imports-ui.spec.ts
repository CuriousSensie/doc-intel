import { expect, test } from "@playwright/test";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createConfirmedTestUser,
  createTestOrganization,
  deleteTestOrganization,
  deleteTestUser,
  loginAsTestUser,
  type TestUser
} from "./helpers/test-fixtures";

test.describe("import wizard", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let user: TestUser;
  let orgId: string;
  let jobId: string;
  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    orgId = await createTestOrganization(user.userId, `Import UI ${Date.now()}`);
    const { error } = await createAdminClient()
      .from("entity_types")
      .insert({
        organization_id: orgId,
        key: "customer",
        name: "Customer",
        name_plural: "Customers",
        field_schema: [
          { key: "vat", label: "VAT number", type: "string", identifier_kind: "vat" },
          { key: "amount", label: "Amount", type: "decimal", required: true }
        ]
      });
    if (error) throw error;
  });
  test.afterAll(async () => {
    if (orgId) {
      const admin = createAdminClient();
      const { data: jobs } = await admin
        .from("import_jobs")
        .select("storage_key")
        .eq("organization_id", orgId);
      const keys = (jobs ?? []).flatMap((job) => (job.storage_key ? [job.storage_key] : []));
      if (keys.length) await admin.storage.from("import-sources").remove(keys);
      await deleteTestOrganization(orgId);
    }
    if (user) await deleteTestUser(user.userId);
  });

  test("uploads, previews, validates, requires review, runs and reports a real entities import", async ({
    page
  }, testInfo) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/imports");
    await expect(page.getByRole("heading", { name: "Imports", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "New import", exact: true }).click();
    await expect(page.getByRole("button", { name: "Upload and continue" })).toBeDisabled();
    await page.getByLabel("Choose a file or drop it here").setInputFiles({
      name: "legacy.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: Buffer.from("old")
    });
    await expect(page.getByRole("alert").filter({ hasText: "save as .xlsx" })).toBeVisible();
    await page.getByLabel("Choose a file or drop it here").setInputFiles({
      name: "customers-č.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "vat;name;amount\nSI17894839;Čebelica d.o.o.;1.234,56\nSI12345678;Needs correction;invalid\n",
        "utf8"
      )
    });
    await page.getByRole("button", { name: "Upload and continue" }).click();
    await expect(page.getByRole("button", { name: "Analyze file" })).toBeVisible({
      timeout: 30_000
    });
    jobId = page.url().split("/").pop()!;
    await page.getByRole("button", { name: "Analyze file" }).click();
    await expect(page.getByRole("heading", { name: "Check your file preview" })).toBeVisible({
      timeout: 40_000
    });
    await page.getByLabel("Name column", { exact: true }).selectOption("1");
    await page.getByLabel("VAT number", { exact: true }).selectOption("0");
    await page.getByLabel("Amount *", { exact: true }).selectOption("2");
    await page.getByLabel("Decimal separator").selectOption(",");
    await expect(page.getByText("1.234,56 → 1234.56", { exact: true })).toBeVisible();
    if (process.env.IMPORT_CAPTURE_UI)
      await page.screenshot({ path: testInfo.outputPath("mapping-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.IMPORT_CAPTURE_UI)
      await page.screenshot({ path: testInfo.outputPath("mapping-mobile.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Validate all rows" }).click();
    await expect(page.getByRole("heading", { name: "Review before importing" })).toBeVisible({
      timeout: 40_000
    });
    await expect(page.getByRole("button", { name: "Start import", exact: true })).toBeDisabled();
    // Refresh must retain analysis, mapping and validation while resetting acknowledgement.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review before importing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start import", exact: true })).toBeDisabled();
    await page.getByText("Save this mapping for next time", { exact: true }).click();
    await page.getByLabel("Mapping name", { exact: true }).fill("Monthly customers");
    await page.getByRole("button", { name: "Save mapping", exact: true }).click();
    await expect(page.getByText("Mapping saved.", { exact: true })).toBeVisible({
      timeout: 15_000
    });
    await expect(page.getByText("Check the decimal separator.", { exact: true })).toBeVisible({
      timeout: 15_000
    });
    if (process.env.IMPORT_CAPTURE_UI)
      await page.screenshot({ path: testInfo.outputPath("review-desktop.png"), fullPage: true });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import results", exact: true })).toBeVisible({
      timeout: 60_000
    });
    await expect(page.getByText("2 of 2 rows processed", { exact: true })).toBeVisible();
    const { data: entities, error } = await createAdminClient()
      .from("entities")
      .select("display_name, data")
      .eq("organization_id", orgId);
    expect(error).toBeNull();
    expect(entities).toHaveLength(1);
    expect(entities![0].display_name).toBe("Čebelica d.o.o.");
    expect(entities![0].data).toMatchObject({ vat: "SI17894839", amount: 1234.56 });
    const report = await page.request.get(`/api/imports/${jobId}/report`);
    expect(report.ok()).toBe(true);
    expect(await report.text()).toContain("INVALID_NUMBER");
    await page.goto("/dashboard/imports/new");
    await expect(page.getByLabel("Saved column mapping")).toBeVisible();
    await page.getByLabel("Saved column mapping").selectOption({ label: "Monthly customers" });
    await page.getByLabel("Choose a file or drop it here").setInputFiles({
      name: "next-month.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("vat;name;amount\nSI17894839;Čebelica d.o.o.;2.345,67\n")
    });
    await page.getByRole("button", { name: "Upload and continue" }).click();
    await page.getByRole("button", { name: "Analyze file" }).click();
    await expect(page.getByLabel("VAT number", { exact: true })).toHaveValue("0", {
      timeout: 30_000
    });
    await expect(page.getByLabel("Amount *", { exact: true })).toHaveValue("2");
    await expect(page.getByLabel("Decimal separator")).toHaveValue(",");
  });

  test("document status API and read-only access stay scoped to the organization", async ({
    page
  }) => {
    await loginAsTestUser(page, user);
    const admin = createAdminClient();
    const { data: docJob, error } = await admin
      .from("import_jobs")
      .insert({
        organization_id: orgId,
        kind: "documents",
        created_by: user.userId,
        status: "completed",
        source_filename: "archive.zip"
      })
      .select("id")
      .single();
    if (error) throw error;
    const { data: rows, error: rowError } = await admin
      .from("import_rows")
      .insert(
        [1, 2, 3].map((row_number) => ({
          organization_id: orgId,
          import_job_id: docJob.id,
          row_number,
          raw: [],
          status: "ok" as const
        }))
      )
      .select("id");
    if (rowError) throw rowError;
    const { error: uploadsError } = await admin.from("document_uploads").insert(
      rows!.map((row, index) => ({
        organization_id: orgId,
        import_row_id: row.id,
        storage_path: `${orgId}/ui-progress-${index}`,
        filename: `test-${index}.pdf`,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        declared_mime_type: "application/pdf",
        size_bytes: 100,
        status: (["completed", "failed", "processing"] as const)[index],
        created_by: user.userId
      }))
    );
    if (uploadsError) throw uploadsError;
    const response = await page.request.get(`/api/imports/${docJob.id}`);
    expect(response.ok()).toBe(true);
    expect((await response.json()).data.document_progress).toEqual({
      total: 3,
      completed: 1,
      failed: 1,
      pending: 1
    });
    await page.goto(`/dashboard/imports/${docJob.id}`);
    await expect(
      page.getByText("1 ready · 1 processing · 1 failed", { exact: true })
    ).toBeVisible();
    await admin
      .from("organization_members")
      .update({ role: "read-only" })
      .eq("organization_id", orgId)
      .eq("user_id", user.userId);
    await page.goto("/dashboard/imports");
    await expect(page.getByRole("link", { name: "New import", exact: true })).toHaveCount(0);
    await page.goto("/dashboard/imports/new");
    await expect(page.getByText(/You can review imports/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload and continue" })).toHaveCount(0);
    await admin
      .from("organization_members")
      .update({ role: "owner" })
      .eq("organization_id", orgId)
      .eq("user_id", user.userId);
  });
});
