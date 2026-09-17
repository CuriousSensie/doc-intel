import { exportsConfig } from "@/config/exports";
import { apiError } from "@/lib/api-response";
import { AuthenticationError, NotFoundError, ValidationError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getBackgroundOperation } from "@/modules/background-operations/background-operations.service";

export const dynamic = "force-dynamic";

// ADR-0009: a fetch/redirect target, not a form submission. The file itself lives in a private
// storage bucket (admin-only per the migration's own comment) — this issues a short-lived
// signed URL and redirects, same pattern as documents' preview/download routes but for our own
// generated files rather than a Paperless pass-through.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    requireFeature("documents");
    const { id } = await params;
    const ctx = await buildRequestContext();
    const operation = await getBackgroundOperation(ctx, id);

    if (operation.kind !== "export") throw new NotFoundError("Export not found");
    if (operation.status !== "completed") {
      throw new ValidationError("Export is not ready yet");
    }

    const result = operation.result as { storagePath?: string } | null;
    if (!result?.storagePath) throw new NotFoundError("Export file not found");

    const admin = createAdminClient();
    const { data: signed, error } = await admin.storage
      .from(exportsConfig.bucket)
      .createSignedUrl(result.storagePath, exportsConfig.downloadUrlExpirySeconds);

    if (error || !signed) throw new NotFoundError("Export file not found");

    return Response.redirect(signed.signedUrl, 307);
  } catch (error) {
    return apiError(error);
  }
}
