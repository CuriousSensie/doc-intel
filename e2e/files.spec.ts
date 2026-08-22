import { expect, test } from "@playwright/test";

test("redirects guests away from the files dashboard to login", async ({ page }) => {
  await page.goto("/dashboard/files");
  await expect(page).toHaveURL(/\/login/);
});

test("redirects guests away from a file download link to login", async ({ page }) => {
  await page.goto("/api/files/00000000-0000-0000-0000-000000000000/download");
  await expect(page).toHaveURL(/\/login/);
});
