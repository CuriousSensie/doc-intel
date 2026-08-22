import { NextResponse } from "next/server";

import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { getFileDownloadUrl } from "@/modules/files/files.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(`/dashboard/files`);
  const { id } = await params;

  try {
    const signedUrl = await getFileDownloadUrl(id);
    return NextResponse.redirect(signedUrl, { status: 307 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File not found";
    return NextResponse.redirect(
      new URL(withStatus("/dashboard/files", "error", message), request.url),
      { status: 307 }
    );
  }
}
