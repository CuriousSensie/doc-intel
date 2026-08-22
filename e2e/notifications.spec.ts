import { expect, test } from "@playwright/test";

test("redirects guests away from notifications to login", async ({ page }) => {
  await page.goto("/dashboard/notifications");
  await expect(page).toHaveURL(/\/login/);
});

test("redirects the settings notifications shortcut to the real inbox, which also requires login", async ({
  page
}) => {
  await page.goto("/settings/notifications");
  await expect(page).toHaveURL(/\/login/);
});
