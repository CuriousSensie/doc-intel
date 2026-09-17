"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
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

function redirectWithError(path: string, error: unknown, locale: Locale): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  return redirect({ href: withStatus(path, "error", message), locale });
}

export async function registerAction(formData: FormData) {
  const locale = await getLocale();
  const parsed = registerSchema.safeParse(formDataToObject(formData));
  const next = getSafeRedirectPath(formData.get("next"));

  if (!parsed.success) {
    return redirect({
      href: withStatus(`/register?next=${encodeURIComponent(next)}`, "error", firstZodError(parsed.error)),
      locale
    });
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
    redirectWithError("/register", error, locale);
  }

  if (data.user) {
    await logEvent({ actorId: data.user.id, action: "auth.user.registered" });
  }

  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/login", "message", t("status.verifyEmailToSignIn")), locale });
}

export async function loginAction(formData: FormData) {
  const locale = await getLocale();
  const parsed = loginSchema.safeParse(formDataToObject(formData));
  const next = getSafeRedirectPath(formData.get("next"));

  if (!parsed.success) {
    return redirect({
      href: withStatus(`/login?next=${encodeURIComponent(next)}`, "error", firstZodError(parsed.error)),
      locale
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error) {
    redirectWithError("/login", error, locale);
  }

  if (data.user) {
    await logEvent({ actorId: data.user.id, action: "auth.login" });
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance.error && assurance.data.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
    return redirect({ href: `/mfa/challenge?next=${encodeURIComponent(next)}`, locale });
  }

  return redirect({ href: next, locale });
}

export async function logoutAction() {
  const locale = await getLocale();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  await supabase.auth.signOut();

  if (data.user) {
    await logEvent({ actorId: data.user.id, action: "auth.logout" });
  }

  return redirect({ href: "/", locale });
}

export async function forgotPasswordAction(formData: FormData) {
  const locale = await getLocale();
  const parsed = emailSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/forgot-password", "error", firstZodError(parsed.error)), locale });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: absoluteUrl("/auth/callback?next=/reset-password")
  });

  if (error) {
    redirectWithError("/forgot-password", error, locale);
  }

  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/login", "message", t("status.passwordResetInstructionsSent")), locale });
}

export async function resetPasswordAction(formData: FormData) {
  const locale = await getLocale();
  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/reset-password", "error", firstZodError(parsed.error)), locale });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password
  });

  if (error) {
    redirectWithError("/reset-password", error, locale);
  }

  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/dashboard", "message", t("status.passwordUpdated")), locale });
}

export async function resendVerificationAction(formData: FormData) {
  const locale = await getLocale();
  const parsed = emailSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/resend-verification", "error", firstZodError(parsed.error)), locale });
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
    redirectWithError("/resend-verification", error, locale);
  }

  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/login", "message", t("status.verificationEmailSent")), locale });
}

export async function oauthAction(formData: FormData) {
  const locale = await getLocale();
  const provider = formData.get("provider");
  const next = getSafeRedirectPath(formData.get("next"));

  if (provider !== "google" && provider !== "github") {
    redirectWithError("/login", new Error("Unsupported OAuth provider"), locale);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as Provider,
    options: {
      redirectTo: absoluteUrl(`/auth/callback?next=${encodeURIComponent(next)}`)
    }
  });

  if (error || !data.url) {
    redirectWithError("/login", error ?? new Error("OAuth provider did not return a URL"), locale);
  }

  return redirect({ href: data.url, locale });
}

export async function updateProfileAction(formData: FormData) {
  const locale = await getLocale();
  const context = await requireUser("/settings/profile");
  const parsed = profileSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/settings/profile", "error", firstZodError(parsed.error)), locale });
  }

  await updateProfile(context.user.id, parsed.data);
  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/settings/profile", "message", t("status.profileUpdated")), locale });
}

export async function completeOnboardingAction(formData: FormData) {
  const locale = await getLocale();
  const context = await requireUser("/onboarding");
  const parsed = profileSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/onboarding", "error", firstZodError(parsed.error)), locale });
  }

  await updateProfile(context.user.id, {
    ...parsed.data,
    onboarding_completed: true
  });

  return redirect({ href: "/dashboard", locale });
}

export async function changePasswordAction(formData: FormData) {
  const locale = await getLocale();
  const context = await requireUser("/settings/security");
  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData));

  if (!parsed.success) {
    return redirect({ href: withStatus("/settings/security", "error", firstZodError(parsed.error)), locale });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password
  });

  if (error) {
    redirectWithError("/settings/security", error, locale);
  }

  await logEvent({ actorId: context.user.id, action: "auth.password_changed" });
  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/settings/security", "message", t("status.passwordChanged")), locale });
}

export async function startMfaEnrollmentAction() {
  const locale = await getLocale();
  await requireUser("/settings/security");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: appConfig.name
  });

  if (error) {
    redirectWithError("/settings/security", error, locale);
  }

  const params = new URLSearchParams({
    factorId: data.id,
    qr: data.totp.qr_code,
    secret: data.totp.secret
  });

  return redirect({ href: `/mfa/enroll?${params.toString()}`, locale });
}

export async function verifyMfaEnrollmentAction(formData: FormData) {
  const locale = await getLocale();
  const context = await requireUser("/mfa/enroll");
  const parsed = mfaCodeSchema.safeParse(formDataToObject(formData));

  if (!parsed.success || !parsed.data.factorId) {
    const t = await getTranslations("auth");
    return redirect({ href: withStatus("/settings/security", "error", t("status.invalidMfaVerificationRequest")), locale });
  }

  const supabase = await createClient();
  const challenge = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId
  });

  if (challenge.error) {
    redirectWithError("/settings/security", challenge.error, locale);
  }

  const verified = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.data.id,
    code: parsed.data.code
  });

  if (verified.error) {
    redirectWithError("/mfa/enroll", verified.error, locale);
  }

  await logEvent({ actorId: context.user.id, action: "auth.mfa.enabled" });
  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/settings/security", "message", t("status.mfaEnabled")), locale });
}

export async function verifyMfaChallengeAction(formData: FormData) {
  const locale = await getLocale();
  await requireUser("/mfa/challenge");
  const parsed = mfaCodeSchema.safeParse(formDataToObject(formData));
  const next = getSafeRedirectPath(formData.get("next"));

  if (!parsed.success) {
    return redirect({
      href: withStatus(`/mfa/challenge?next=${encodeURIComponent(next)}`, "error", firstZodError(parsed.error)),
      locale
    });
  }

  const supabase = await createClient();
  const factors = await supabase.auth.mfa.listFactors();
  const factorId = parsed.data.factorId ?? factors.data?.totp[0]?.id;

  if (factors.error || !factorId) {
    redirectWithError("/mfa/challenge", factors.error ?? new Error("No MFA factor found"), locale);
  }

  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    redirectWithError("/mfa/challenge", challenge.error, locale);
  }

  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: parsed.data.code
  });

  if (verified.error) {
    redirectWithError("/mfa/challenge", verified.error, locale);
  }

  return redirect({ href: next, locale });
}

export async function disableMfaAction(formData: FormData) {
  const locale = await getLocale();
  const context = await requireUser("/settings/security");
  const factorId = formData.get("factorId");

  if (typeof factorId !== "string") {
    const t = await getTranslations("auth");
    return redirect({ href: withStatus("/settings/security", "error", t("status.missingMfaFactor")), locale });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    redirectWithError("/settings/security", error, locale);
  }

  await logEvent({ actorId: context.user.id, action: "auth.mfa.disabled" });
  const t = await getTranslations("auth");
  return redirect({ href: withStatus("/settings/security", "message", t("status.mfaDisabled")), locale });
}
