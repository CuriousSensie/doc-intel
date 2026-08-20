import { cookies } from "next/headers";

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
