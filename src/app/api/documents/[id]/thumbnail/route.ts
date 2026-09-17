import { apiError } from "@/lib/api-response";
import { AuthenticationError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/documents.service";

export const dynamic = "force-dynamic";

// Same authenticated-proxy pattern as preview/route.ts and download/route.ts (ADR-0009) — used
// by the Small Cards / Large Cards documents-list view modes. Never a redirect to a raw
// Paperless URL, which would expose the tenant service-user token to the browser.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    requireFeature("documents");
    const { id } = await params;

    // getDocument() 404s (never 403) for a wrong-org id — specs/03-api.md's explicit rule.
    const doc = await getDocument(id);

    const client = await paperlessFor(doc.organization_id);
    const upstream = await client.getStream(`/api/documents/${doc.paperless_document_id}/thumb/`);

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/webp",
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
