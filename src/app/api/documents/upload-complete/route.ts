import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api-response";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { completeUpload } from "@/modules/documents/documents.service";
import { getAuthContext } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ upload_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const upload = await completeUpload(context.user.id, parsed.data.upload_id);

    return apiSuccess({ upload_id: upload.id, status: upload.status }, undefined, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
