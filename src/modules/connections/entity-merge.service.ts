import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";

// merge_entities() (supabase/migrations/20260914000000_entities_connections_fields_views.sql)
// does the actual work — moving connections/identifiers, archiving the merged entity, and
// writing the audit_logs row — atomically, inside one SECURITY DEFINER function (ADR-0008: a
// merge is exactly the kind of mutation that pattern exists for). This is a thin wrapper that
// maps the function's raised exceptions onto the app's error taxonomy.
//
// The function checks auth.uid()/has_organization_write_access() itself, which only resolves
// for a real RLS-scoped session — so this must be called with a request-context ServiceContext
// (ctx.db from buildRequestContext()), never a worker/admin-context one. There is no worker-
// triggered merge path in the spec, so this isn't a real restriction in practice.
export async function mergeEntities(
  ctx: ServiceContext,
  input: { keepId: string; mergeId: string }
): Promise<void> {
  const { error } = await ctx.db.rpc("merge_entities", {
    p_keep_id: input.keepId,
    p_merge_id: input.mergeId
  });

  if (!error) return;

  if (/Authentication required/i.test(error.message)) {
    throw new AuthenticationError(error.message);
  }
  if (/not authorized/i.test(error.message)) {
    throw new AuthorizationError(error.message);
  }
  if (
    /across organizations/i.test(error.message) ||
    /into itself/i.test(error.message) ||
    /not found/i.test(error.message)
  ) {
    throw new ValidationError(error.message);
  }

  throw error;
}
