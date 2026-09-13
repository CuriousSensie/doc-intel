import { cookies } from "next/headers";
import { cache } from "react";

import { getMembership, listUserOrganizations } from "@/modules/organizations/organizations.service";

const ACTIVE_ORG_COOKIE = "active_org";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// cache()'d for the same reason as getCurrentUser()/getCurrentProfile() (src/modules/auth/
// session.ts) — the dashboard layout resolves this once already; every page was redoing the
// same membership/listUserOrganizations round trip on top of that.
export const getActiveOrganizationId = cache(async (userId: string) => {
  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  if (cookieOrgId && (await getMembership(cookieOrgId, userId))) {
    return cookieOrgId;
  }

  const memberships = await listUserOrganizations(userId);
  return memberships[0]?.organization.id ?? null;
});

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
