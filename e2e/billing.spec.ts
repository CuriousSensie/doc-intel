import { expect, test } from "@playwright/test";

test("redirects guests away from billing settings to login", async ({ page }) => {
  await page.goto("/settings/billing");
  await expect(page).toHaveURL(/\/login/);
});

test("shows the pricing page to guests with a way to get started", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Pricing" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
});
