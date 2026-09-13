import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { AuthorizationError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type AuthContext = {
  user: User;
  profile: Profile | null;
};

function hasSupabasePublicConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

// cache()'d — every dashboard layout + page independently called this per request before
// (each its own network round trip to Supabase Auth to verify the JWT), so a single page render
// paid for it twice. React's cache() dedupes calls with the same arguments within one render
// pass, not across requests, so this changes nothing about session freshness/security.
export const getCurrentUser = cache(async () => {
  if (!hasSupabasePublicConfig()) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
});

export const getCurrentProfile = cache(async (userId: string) => {
  if (!hasSupabasePublicConfig()) {
    return null;
  }

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data;
});

export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  return {
    user,
    profile: await getCurrentProfile(user.id)
  };
}

export async function requireUser(next?: string): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }

  if (context.profile?.suspended_at) {
    redirect("/login?error=Your account has been suspended");
  }

  return context;
}

export async function requireGuest() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }
}

export async function requireAdmin(): Promise<AuthContext> {
  const context = await requireUser();

  if (!context.profile?.is_app_admin) {
    throw new AuthorizationError("Application administrator access required");
  }

  return context;
}

export async function requireMfaAssurance(next = "/dashboard") {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error) {
    throw error;
  }

  if (data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
    redirect(`/mfa/challenge?next=${encodeURIComponent(next)}`);
  }

  return data;
}
