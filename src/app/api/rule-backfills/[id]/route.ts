import { apiError, apiSuccess } from "@/lib/api-response";
import { AuthenticationError, NotFoundError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

// docs/adr/0009-route-handlers-vs-server-actions.md: job-status polling is a Route Handler,
// mirroring src/app/api/imports/[id]/route.ts exactly.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    requireFeature("rules");
    const { id } = await params;
    const ctx = await buildRequestContext();

    const { data: backfill, error } = await ctx.db
      .from("rule_backfills")
      .select("*")
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (error) throw error;
    if (!backfill) throw new NotFoundError("Rule backfill not found");

    return apiSuccess({
      id: backfill.id,
      rule_id: backfill.rule_id,
      status: backfill.status,
      matched_count: backfill.matched_count,
      applied_count: backfill.applied_count,
      started_at: backfill.started_at,
      finished_at: backfill.finished_at
    });
  } catch (error) {
    return apiError(error);
  }
}
