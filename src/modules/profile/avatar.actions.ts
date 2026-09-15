"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { uploadAvatar } from "@/modules/profile/avatar.service";

export async function uploadAvatarAction(formData: FormData) {
  const context = await requireUser("/settings/profile");
  const [t, locale] = await Promise.all([getTranslations("settings"), getLocale()]);
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return redirect({ href: withStatus("/settings/profile", "error", t("actions.chooseImage")), locale });
  }

  try {
    await uploadAvatar(context, {
      buffer: Buffer.from(await file.arrayBuffer()),
      declaredMimeType: file.type || "application/octet-stream",
      size: file.size
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : t("actions.somethingWentWrong");
    return redirect({ href: withStatus("/settings/profile", "error", message), locale });
  }

  return redirect({ href: "/settings/profile", locale });
}
