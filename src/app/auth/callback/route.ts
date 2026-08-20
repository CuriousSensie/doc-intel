import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getSafeRedirectPath } from "@/modules/auth/redirects";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeRedirectPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
      const isLocal = process.env.NODE_ENV === "development";

      if (!isLocal && forwardedHost) {
        return NextResponse.redirect(`${forwardedProto}://${forwardedHost}${next}`);
      }

      return NextResponse.redirect(`${requestUrl.origin}${next}`);
    }
  }

  return NextResponse.redirect(`${requestUrl.origin}/login?error=Could not verify authentication link`);
}
