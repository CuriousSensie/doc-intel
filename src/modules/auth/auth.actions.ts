"use server";

import { redirect } from "next/navigation";
import type { Provider } from "@supabase/supabase-js";

import { appConfig } from "@/config/app";
import { logEvent } from "@/lib/events";
import { absoluteUrl } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { updateProfile } from "@/modules/users/profiles.service";
import {
  emailSchema,
  firstZodError,
  formDataToObject,
  loginSchema,
  mfaCodeSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema
} from "@/modules/auth/auth.schemas";
import { getSafeRedirectPath, withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";

function redirectWithError(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus(path, "error", message));
}

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse(formDataToObject(formData));
  const next = getSafeRedirectPath(formData.get("next"));

  if (!parsed.success) {
    redirect(withStatus(`/register?next=${encodeURIComponent(next)}`, "error", firstZodError(parsed.error)));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        name: parsed.data.name
      },
      emailRedirectTo: absoluteUrl(`/auth/callback?next=${encodeURIComponent("/onboarding")}`)
    }
  });

  if (error) {
    redirectWithError("/register", error);
  }

  if (data.user) {
    await logEvent({ actorId: data.user.id, action: "auth.user.registered" });
  }

  redirect(
    withStatus(
      "/login",
      "message",
      "Check your email to verify your account, then sign in to continue."
    )
  );
}

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse(formDataToObject(formData));
  const next = getSafeRedirectPath(formData.get("next"));

  if (!parsed.success) {
    redirect(withStatus(`/login?next=${encodeURIComponent(next)}`, "error", firstZodError(parsed.error)));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error) {
    redirectWithError("/login", error);
  }

  if (data.user) {
    await logEvent({ actorId: data.user.id, action: "auth.login" });
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance.error && assurance.data.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
    redirect(`/mfa/challenge?next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  await supabase.auth.signOut();

  if (data.user) {
    await logEvent({ actorId: data.user.id, action: "auth.logout" });
  }

  redirect("/");
}

export async function forgotPasswordAction(formData: FormData) {
  const parsed = emailSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/forgot-password", "error", firstZodError(parsed.error)));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: absoluteUrl("/auth/callback?next=/reset-password")
  });

  if (error) {
    redirectWithError("/forgot-password", error);
  }

  redirect(withStatus("/login", "message", "Password reset instructions have been sent."));
}

export async function resetPasswordAction(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/reset-password", "error", firstZodError(parsed.error)));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password
  });

  if (error) {
    redirectWithError("/reset-password", error);
  }

  redirect(withStatus("/dashboard", "message", "Password updated."));
}

export async function resendVerificationAction(formData: FormData) {
  const parsed = emailSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/resend-verification", "error", firstZodError(parsed.error)));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: {
      emailRedirectTo: absoluteUrl("/auth/callback?next=/onboarding")
    }
  });

  if (error) {
    redirectWithError("/resend-verification", error);
  }

  redirect(withStatus("/login", "message", "Verification email sent."));
}

export async function oauthAction(formData: FormData) {
  const provider = formData.get("provider");
  const next = getSafeRedirectPath(formData.get("next"));

  if (provider !== "google" && provider !== "github") {
    redirectWithError("/login", new Error("Unsupported OAuth provider"));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as Provider,
    options: {
      redirectTo: absoluteUrl(`/auth/callback?next=${encodeURIComponent(next)}`)
    }
  });

  if (error || !data.url) {
    redirectWithError("/login", error ?? new Error("OAuth provider did not return a URL"));
  }

  redirect(data.url);
}

export async function updateProfileAction(formData: FormData) {
  const context = await requireUser("/settings/profile");
  const parsed = profileSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/settings/profile", "error", firstZodError(parsed.error)));
  }

  await updateProfile(context.user.id, parsed.data);
  redirect(withStatus("/settings/profile", "message", "Profile updated."));
}

export async function completeOnboardingAction(formData: FormData) {
  const context = await requireUser("/onboarding");
  const parsed = profileSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/onboarding", "error", firstZodError(parsed.error)));
  }

  await updateProfile(context.user.id, {
    ...parsed.data,
    onboarding_completed: true
  });

  redirect("/dashboard");
}

export async function changePasswordAction(formData: FormData) {
  const context = await requireUser("/settings/security");
  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    redirect(withStatus("/settings/security", "error", firstZodError(parsed.error)));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password
  });

  if (error) {
    redirectWithError("/settings/security", error);
  }

  await logEvent({ actorId: context.user.id, action: "auth.password_changed" });
  redirect(withStatus("/settings/security", "message", "Password changed."));
}

export async function startMfaEnrollmentAction() {
  await requireUser("/settings/security");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: appConfig.name
  });

  if (error) {
    redirectWithError("/settings/security", error);
  }

  const params = new URLSearchParams({
    factorId: data.id,
    qr: data.totp.qr_code,
    secret: data.totp.secret
  });

  redirect(`/mfa/enroll?${params.toString()}`);
}

export async function verifyMfaEnrollmentAction(formData: FormData) {
  const context = await requireUser("/mfa/enroll");
  const parsed = mfaCodeSchema.safeParse(formDataToObject(formData));

  if (!parsed.success || !parsed.data.factorId) {
    redirect(withStatus("/settings/security", "error", "Invalid MFA verification request"));
  }

  const supabase = await createClient();
  const challenge = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId
  });

  if (challenge.error) {
    redirectWithError("/settings/security", challenge.error);
  }

  const verified = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.data.id,
    code: parsed.data.code
  });

  if (verified.error) {
    redirectWithError("/mfa/enroll", verified.error);
  }

  await logEvent({ actorId: context.user.id, action: "auth.mfa.enabled" });
  redirect(withStatus("/settings/security", "message", "MFA enabled."));
}

export async function verifyMfaChallengeAction(formData: FormData) {
  await requireUser("/mfa/challenge");
  const parsed = mfaCodeSchema.safeParse(formDataToObject(formData));
  const next = getSafeRedirectPath(formData.get("next"));

  if (!parsed.success) {
    redirect(withStatus(`/mfa/challenge?next=${encodeURIComponent(next)}`, "error", firstZodError(parsed.error)));
  }

  const supabase = await createClient();
  const factors = await supabase.auth.mfa.listFactors();
  const factorId = parsed.data.factorId ?? factors.data?.totp[0]?.id;

  if (factors.error || !factorId) {
    redirectWithError("/mfa/challenge", factors.error ?? new Error("No MFA factor found"));
  }

  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    redirectWithError("/mfa/challenge", challenge.error);
  }

  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: parsed.data.code
  });

  if (verified.error) {
    redirectWithError("/mfa/challenge", verified.error);
  }

  redirect(next);
}

export async function disableMfaAction(formData: FormData) {
  const context = await requireUser("/settings/security");
  const factorId = formData.get("factorId");

  if (typeof factorId !== "string") {
    redirect(withStatus("/settings/security", "error", "Missing MFA factor"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    redirectWithError("/settings/security", error);
  }

  await logEvent({ actorId: context.user.id, action: "auth.mfa.disabled" });
  redirect(withStatus("/settings/security", "message", "MFA disabled."));
}
