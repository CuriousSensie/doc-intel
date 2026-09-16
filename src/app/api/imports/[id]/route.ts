import { apiError, apiSuccess } from "@/lib/api-response";
import { AuthenticationError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getImportJob, getImportDocumentProgress } from "@/modules/imports/imports.service";

export const dynamic = "force-dynamic";

// docs/adr/0009-route-handlers-vs-server-actions.md: job-status polling is a Route Handler.
// specs/03-api.md: "GET /imports/:id -> Status + counters (poll every 2s while running)".
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    requireFeature("imports");
    const { id } = await params;
    const ctx = await buildRequestContext();
    const job = await getImportJob(ctx, id);

    return apiSuccess({
      id: job.id,
      kind: job.kind,
      status: job.status,
      total_rows: job.total_rows,
      processed_rows: job.processed_rows,
      succeeded_rows: job.succeeded_rows,
      failed_rows: job.failed_rows,
      skipped_rows: job.skipped_rows,
      error: job.error,
      started_at: job.started_at,
      finished_at: job.finished_at,
      validation: (job.options as { validation?: unknown } | null)?.validation ?? null,
      document_progress: job.kind === "documents" ? await getImportDocumentProgress(ctx, id) : null
    });
  } catch (error) {
    return apiError(error);
  }
}
