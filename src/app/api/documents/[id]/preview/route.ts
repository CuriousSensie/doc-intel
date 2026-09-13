import { apiError } from "@/lib/api-response";
import { AuthenticationError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/documents.service";

export const dynamic = "force-dynamic";

// ADR-0009: streamed through our own Route Handler, authenticated by our session cookie —
// never a redirect to a raw Paperless URL, which would have to carry the tenant service-user
// token where the browser (and anything logging that URL) could see it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    requireFeature("documents");
    const { id } = await params;

    // getDocument() 404s (never 403) for a wrong-org id — specs/03-api.md's explicit rule.
    // No pre-resolved active org needed — see getDocument()'s own doc comment.
    const doc = await getDocument(id);

    const client = await paperlessFor(doc.organization_id);
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
