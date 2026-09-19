import { expect, test } from "@playwright/test";

test("loads the foundation landing page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /build the product/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /open dashboard/i })).toBeVisible();
});

test("health endpoint returns ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ ok: true, service: "documenti" });
});
