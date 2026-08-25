import { expect, test } from "@playwright/test";

test("redirects guests away from the admin dashboard to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("redirects guests away from admin users to login", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login/);
});

test("redirects guests away from admin organizations to login", async ({ page }) => {
  await page.goto("/admin/organizations");
  await expect(page).toHaveURL(/\/login/);
});

test("redirects guests away from the admin audit log to login", async ({ page }) => {
  await page.goto("/admin/audit-log");
  await expect(page).toHaveURL(/\/login/);
});
