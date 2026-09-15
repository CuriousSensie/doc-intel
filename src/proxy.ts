import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const handleI18nRouting = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  // API routes aren't pages — never under [locale], and must never be locale-redirected
  // (next-intl's middleware has no concept of them and would otherwise try to send
  // /api/search to /en/api/search). The Supabase session refresh below still runs for them,
  // same as before this file gained i18n routing.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return updateSession(request);
  }

  const i18nResponse = handleI18nRouting(request);

  return updateSession(request, i18nResponse);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
