import { cache } from "react";

import { listUserOrganizations } from "@/modules/organizations/organizations.service";

// cache()'d for the same reason as getCurrentUser()/getCurrentProfile() (src/modules/auth/
// session.ts) — several routes resolve "the user's organization" independently per request.
// One org per account (see plan: organizations/team revamp), so there's no switching to
// track — this is just the membership lookup, kept under its original name so call sites
// across api routes, service-context, and billing didn't need to change.
export const getActiveOrganizationId = cache(async (userId: string) => {
  const memberships = await listUserOrganizations(userId);
  return memberships[0]?.organization.id ?? null;
});
