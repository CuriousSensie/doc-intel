import type { Page } from "@playwright/test";

import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";

import { loadDotEnv } from "./env";

loadDotEnv();

export type TestUser = { userId: string; email: string; password: string };

export async function createConfirmedTestUser(): Promise<TestUser> {
  const admin = createAdminClient();
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "TestPassword123!";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (error) throw error;

  return { userId: data.user.id, email, password };
}

export async function deleteTestUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(userId);
}

export async function loginAsTestUser(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL(/\/dashboard/);
}

// Bypasses create_organization()'s auth.uid()-scoped RPC (there's no browser session in this
// Node-side setup step) by inserting the same two rows that RPC would, directly, as the admin
// client — a standard test-fixture seeding pattern, not a stand-in for the RPC itself.
export async function createTestOrganization(userId: string, name: string): Promise<string> {
  const admin = createAdminClient();
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name, slug, created_by: userId })
    .select("id")
    .single();
  if (orgError) throw orgError;

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: userId, role: "owner" });
  if (memberError) throw memberError;

  return org.id;
}

export async function deleteTestOrganization(organizationId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("organizations").delete().eq("id", organizationId);
}

// Enqueues the real provision-tenant job and waits for it, the same way
// organizations.service.ts's createOrganization() does — rather than calling provisionTenant()
// directly in this (host) process. Found live: calling it directly persists
// tenant_paperless_config.base_url from *this* process's own PAPERLESS_ADMIN_URL
// (http://localhost:8010, correct for a host-run Next dev server), but the actual upload
// pipeline runs inside the worker container, which needs the docker-network hostname
// (http://paperless-webserver:8000) — two different processes needing two different URLs for
// the same instance. Enqueuing and letting the real worker provision it writes the URL *that
// worker* will also use to process uploads, which is the only copy that has to be consistent.
export async function provisionTestOrganization(organizationId: string): Promise<void> {
  await enqueue(QUEUE_NAMES.provisionTenant, { orgId: organizationId });

  const admin = createAdminClient();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from("organizations")
      .select("provisioning_status")
      .eq("id", organizationId)
      .single();
    if (error) throw error;
    if (data.provisioning_status === "ready") return;
    if (data.provisioning_status === "provisioning_failed") {
      throw new Error(`Provisioning failed for org ${organizationId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Provisioning timed out for org ${organizationId}`);
}
