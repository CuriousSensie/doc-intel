import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getSafeRedirectPath } from "@/modules/auth/redirects";
import { createOrganization, listUserOrganizations } from "@/modules/organizations/organizations.service";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeRedirectPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Registration prompts for the organization name up front (see plan: organizations/
      // team revamp), but no session exists to create it until this confirmation link is
      // followed — this is that "one extra step" made invisible, not a second signup step.
      // Every other auth-link flow (login, password reset, ...) leaves organizationName
      // unset, and an owner who already has an org never re-triggers this.
      const {
        data: { user }
      } = await supabase.auth.getUser();
      const organizationName = user?.user_metadata?.organizationName;

      if (user && typeof organizationName === "string" && organizationName.trim()) {
        try {
          const memberships = await listUserOrganizations(user.id);
          if (memberships.length === 0) {
            await createOrganization(organizationName);
          }
        } catch (orgError) {
          logger.error("auth.callback_organization_creation_failed", {
            userId: user.id,
            errorMessage: orgError instanceof Error ? orgError.message : "Unknown error"
          });
        }
      }

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
