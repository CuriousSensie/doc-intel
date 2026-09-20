import { expect, test } from "@playwright/test";

import {
  createConfirmedTestUser,
  createTestOrganization,
  deleteTestOrganization,
  deleteTestUser,
  loginAsTestUser,
  provisionTestOrganizationDirect,
  type TestUser
} from "./helpers/test-fixtures";

// Milestone 6 (specs/05 Dashboard IA) — entity types, entities, views, and the connection
// picker, all pure-Dokumenti-DB flows with no Paperless dependency, so this drives them through
// the real browser against the real Supabase Cloud project rather than mocking anything.
//
// Form-submission assertions use a longer-than-default timeout: ADR-0013 measured every simple
// Supabase Cloud round trip at 400-800ms, and a create-entity submission chains several
// (buildRequestContext's auth+org lookup, the entity-type fetch, the insert, identifier sync) —
// comfortably past Playwright's 5s default under a cold/just-provisioned tenant.
const FORM_SUBMIT_TIMEOUT = 15_000;

test.describe("entities UI", () => {
  let user: TestUser;
  let organizationId: string;

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    organizationId = await createTestOrganization(user.userId, `E2E Entities ${Date.now()}`);
    await provisionTestOrganizationDirect(organizationId);
  });

  test.afterAll(async () => {
    await deleteTestOrganization(organizationId);
    await deleteTestUser(user.userId);
  });

  // complete_provisioning() seeds entity types with Slovenian labels (specs/00 D7: Slovenia/EU
  // first) — "Stranke"/"Projekti"/"Pogodbe"/"Zaposleni", not their English names. Routes still
  // address types by their (English) `key`, e.g. /dashboard/entities/customer.
  test("entities index lists the seeded system types with zero counts", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stranke" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Projekti" })).toBeVisible();
  });

  test("creates a customer entity via the type list page's form", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/entities/customer");
    await expect(page.getByRole("heading", { name: "Stranke" })).toBeVisible();

    const uniqueName = `Acme e2e ${Date.now()}`;
    await page.getByLabel("Name", { exact: true }).fill(uniqueName);
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("link", { name: uniqueName })).toBeVisible({
      timeout: FORM_SUBMIT_TIMEOUT
    });
  });

  test("opens an entity detail page and sees Overview/Connections/Activity tabs", async ({
    page
  }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/entities/customer");

    const uniqueName = `Acme detail ${Date.now()}`;
    await page.getByLabel("Name", { exact: true }).fill(uniqueName);
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: uniqueName }).click({ timeout: FORM_SUBMIT_TIMEOUT });

    // Same Supabase Cloud round-trip latency as the create-form assertions above (ADR-0013) —
    // this one was missed when Milestone 6 first wrote this test, unlike its neighbors.
    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible({
      timeout: FORM_SUBMIT_TIMEOUT
    });
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Connections" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();

    await page.getByRole("tab", { name: "Connections" }).click();
    await expect(page.getByText("No connections yet.")).toBeVisible();
  });

  test("connects two entities via the searchable connection picker (two interactions)", async ({
    page
  }) => {
    test.setTimeout(60_000);
    await loginAsTestUser(page, user);

    const customerName = `Picker Customer ${Date.now()}`;
    await page.goto("/dashboard/entities/customer");
    await page.getByLabel("Name", { exact: true }).fill(customerName);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: customerName })).toBeVisible({
      timeout: FORM_SUBMIT_TIMEOUT
    });

    const projectName = `Picker Project ${Date.now()}`;
    await page.goto("/dashboard/entities/project");
    await page.getByLabel("Name", { exact: true }).fill(projectName);
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: projectName }).click({ timeout: FORM_SUBMIT_TIMEOUT });

    await page.getByRole("tab", { name: "Connections" }).click();
    await page.getByRole("button", { name: "+ Connect" }).click();
    // Interaction 1: type to search.
    await page.getByPlaceholder("Search customers, projects, contracts...").fill(customerName);
    // Interaction 2: click the result.
    await expect(page.getByRole("button", { name: new RegExp(customerName) })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(customerName) }).click();

    // The picker closes and the panel re-renders with the new connection grouped under the
    // customer entity type's (singular) name — poll rather than a single snapshot, since this
    // depends on router.refresh() completing a fresh server round trip.
    await expect(async () => {
      await expect(page.getByText("No connections yet.")).toHaveCount(0);
      await expect(page.getByText(customerName)).toBeVisible();
    }).toPass({ timeout: 15_000 });
  });

  test("entity-types admin page lets an owner add and hide a field", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/entity-types");
    await page.getByRole("link", { name: "Stranke" }).click();

    await expect(page.getByRole("heading", { name: "Stranke" })).toBeVisible();

    await page.getByLabel("Key").fill("test_field");
    await page.getByLabel("Label").fill("Test Field");
    await page.getByRole("button", { name: "Add field" }).click();

    await expect(page.getByText("Test Field", { exact: false })).toBeVisible({
      timeout: FORM_SUBMIT_TIMEOUT
    });

    await page
      .locator("div", { has: page.getByText("key: test_field", { exact: false }) })
      .getByRole("button", { name: "Hide" })
      .first()
      .click();

    await expect(page.getByText("hidden", { exact: true })).toBeVisible({
      timeout: FORM_SUBMIT_TIMEOUT
    });
  });

  test("views page seeds and lists the five starter views", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard/views");

    await expect(page.getByRole("heading", { name: "All documents" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Documents with no connections" })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invoices this year" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open contracts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();

    await page.getByRole("heading", { name: "Documents with no connections" }).click();
    await expect(page).toHaveURL(/hasNoConnections=true/);
  });

  test("home dashboard shows owner/admin org-health summary", async ({ page }) => {
    await loginAsTestUser(page, user);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
  });
});
