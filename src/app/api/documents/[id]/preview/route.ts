import { apiError } from "@/lib/api-response";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/documents.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

// ADR-0009: streamed through our own Route Handler, authenticated by our session cookie —
// never a redirect to a raw Paperless URL, which would have to carry the tenant service-user
// token where the browser (and anything logging that URL) could see it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    const organizationId = await getActiveOrganizationId(context.user.id);
    if (!organizationId) throw new AuthorizationError("No active organization selected");

    requireFeature("documents");
    const { id } = await params;

    // getDocument() 404s (never 403) for a wrong-org id — specs/03-api.md's explicit rule.
    const doc = await getDocument(organizationId, id);

    const client = await paperlessFor(organizationId);
    const upstream = await client.getStream(`/api/documents/${doc.paperless_document_id}/preview/`);

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition": upstream.headers.get("content-disposition") ?? "inline",
        "Cache-Control": "private, max-age=60"
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
