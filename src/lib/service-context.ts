import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AuthorizationError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import type { Database } from "@/types/database";

/**
 * The shared shape every Pomočnik service function that must run in BOTH a Next.js request
 * (Server Action / Route Handler) and a worker job (worker/jobs/*.ts) takes as its first
 * argument, instead of resolving a Supabase client internally.
 *
 * See docs/adr/0007-service-context-pattern.md.
 *
 * Request-side (buildRequestContext): `db` is the RLS-scoped client; RLS is the real
 * enforcement boundary, `orgId` is only used for query narrowing/UX.
 *
 * Worker-side (worker/context.ts#buildJobContext): `db` is the ADMIN client — a worker has no
 * user session for RLS to key off of. Every query a worker-context service function issues
 * MUST filter by `organization_id` explicitly; there is no RLS net underneath it.
 */
export type ServiceContext = {
  db: SupabaseClient<Database>;
  orgId: string;
  actorId: string | null;
  correlationId: string;
};

/**
 * Builds a ServiceContext for a Server Action / Route Handler. Redirects unauthenticated
 * callers (via requireUser()) and throws if the caller has no active organization — every
 * Pomočnik business route requires one.
 */
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

/**
 * Builds a ServiceContext for a worker job. `actorId` is null unless the job payload names a
 * specific acting user (e.g. a manually-triggered rule test); most jobs are system-triggered.
 */
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
