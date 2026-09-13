import { apiError } from "@/lib/api-response";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/documents.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

// Same shape as preview/route.ts — Paperless sets Content-Disposition: attachment on this
// endpoint itself (confirmed live), so this is a plain pass-through, not a separate decision.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    const organizationId = await getActiveOrganizationId(context.user.id);
    if (!organizationId) throw new AuthorizationError("No active organization selected");

    requireFeature("documents");
    const { id } = await params;

    const doc = await getDocument(organizationId, id);

    const client = await paperlessFor(organizationId);
    const upstream = await client.getStream(`/api/documents/${doc.paperless_document_id}/download/`);

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition": upstream.headers.get("content-disposition") ?? "attachment"
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
