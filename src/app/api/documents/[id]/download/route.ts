import { apiError } from "@/lib/api-response";
import { AuthenticationError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/documents.service";

export const dynamic = "force-dynamic";

// Same shape as preview/route.ts — Paperless sets Content-Disposition: attachment on this
// endpoint itself (confirmed live), so this is a plain pass-through, not a separate decision.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    requireFeature("documents");
    const { id } = await params;

    // No pre-resolved active org needed — see getDocument()'s own doc comment.
    const doc = await getDocument(id);

    const client = await paperlessFor(doc.organization_id);
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
