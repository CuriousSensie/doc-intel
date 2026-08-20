import { expect, test } from "@playwright/test";

test("shows auth entry pages", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();

  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
});

test("redirects protected dashboard guests to login", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
});
