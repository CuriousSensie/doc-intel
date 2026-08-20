import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSafeRedirectPath, withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { getMembership, listUserOrganizations } from "@/modules/organizations/organizations.service";

const ACTIVE_ORG_COOKIE = "active_org";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function getActiveOrganizationId(userId: string) {
  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  if (cookieOrgId && (await getMembership(cookieOrgId, userId))) {
    return cookieOrgId;
  }

  const memberships = await listUserOrganizations(userId);
  return memberships[0]?.organization.id ?? null;
}

export async function setActiveOrganization(organizationId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/"
  });
}

export async function clearActiveOrganization() {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
}

export async function switchOrganizationAction(formData: FormData) {
  "use server";

  const context = await requireUser("/organizations");
  const organizationId = formData.get("organizationId");
  const next = getSafeRedirectPath(formData.get("next"));

  if (typeof organizationId !== "string") {
    redirect(withStatus("/organizations", "error", "Missing organization"));
  }

  const membership = await getMembership(organizationId, context.user.id);

  if (!membership) {
    redirect(withStatus("/organizations", "error", "You are not a member of that organization"));
  }

  await setActiveOrganization(organizationId);
  redirect(next);
}
