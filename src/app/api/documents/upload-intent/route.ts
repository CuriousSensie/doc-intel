import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api-response";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/errors";
import { createUploadIntent } from "@/modules/documents/documents.service";
import { getAuthContext } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

// specs/03-api.md: org_id is never accepted from the client — the active org is resolved
// server-side from the session, same as every other org-scoped route in this codebase.
const bodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().trim().min(1),
  // ADR-0019 Phase D — set by folder-upload-form.tsx after resolveOrCreateFolderPathsAction()
  // resolves the file's directory to a folder id; omitted/null for the flat upload flow.
  folderId: z.string().uuid().nullable().optional()
});

export async function POST(request: Request) {
  try {
    // getAuthContext(), not requireUser() — this is a fetch-based JSON route, not a page/form
    // navigation, so an unauthenticated caller needs a 401 body, not a redirect a fetch() call
    // would just follow to an HTML login page.
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();
    const { user } = context;

    const organizationId = await getActiveOrganizationId(user.id);
    if (!organizationId) {
      throw new AuthorizationError("No active organization selected");
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const result = await createUploadIntent(user.id, organizationId, parsed.data);

    return apiSuccess({
      upload_id: result.uploadId,
      url: result.signedUrl,
      token: result.token,
      path: result.path
    });
  } catch (error) {
    return apiError(error);
  }
}
