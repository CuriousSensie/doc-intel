import { expect, test } from "@playwright/test";

test("redirects guests away from organization pages to login", async ({ page }) => {
  await page.goto("/organizations");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/organizations/new");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/settings/team");
  await expect(page).toHaveURL(/\/login/);
});
