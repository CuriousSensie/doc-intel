import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AuthorizationError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import type { Database } from "@/types/database";

// Shared shape for service functions callable from both a request and a worker job.
// createClient() needs Next's cookies(), which doesn't exist in a worker — see
// docs/adr/0007-service-context-pattern.md.
//
// Worker-side db is the ADMIN client (no session to RLS-scope by) — every query a
// worker-context function issues must filter by organization_id explicitly; no RLS net.
export type ServiceContext = {
  db: SupabaseClient<Database>;
  orgId: string;
  actorId: string | null;
  correlationId: string;
};

// Request-side context: RLS client, redirects unauthenticated callers.
export async function buildRequestContext(): Promise<ServiceContext> {
  const { user } = await requireUser();
  const orgId = await getActiveOrganizationId(user.id);

  if (!orgId) {
    throw new AuthorizationError("No active organization selected");
  }

  return {
    db: await createClient(),
    orgId,
    actorId: user.id,
    correlationId: randomUUID()
  };
}

// Worker-side context: admin client, actorId null unless the job names one.
export function buildJobContext(input: {
  orgId: string;
  actorId?: string | null;
  correlationId?: string;
}): ServiceContext {
  return {
    db: createAdminClient(),
    orgId: input.orgId,
    actorId: input.actorId ?? null,
    correlationId: input.correlationId ?? randomUUID()
  };
}
