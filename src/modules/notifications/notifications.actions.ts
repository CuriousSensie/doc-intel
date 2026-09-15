"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { markAllAsRead, markAsRead } from "@/modules/notifications/notifications.service";

export async function markAsReadAction(formData: FormData) {
  const context = await requireUser("/dashboard/notifications");
  const [t, locale] = await Promise.all([getTranslations("dashboard"), getLocale()]);
  const notificationId = formData.get("notificationId");

  if (typeof notificationId !== "string") {
    return redirect({
      href: withStatus("/dashboard/notifications", "error", t("notifications.errors.missingNotification")),
      locale
    });
  }

  try {
    await markAsRead(notificationId, context.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("common.somethingWentWrong");
    return redirect({ href: withStatus("/dashboard/notifications", "error", message), locale });
  }

  return redirect({ href: "/dashboard/notifications", locale });
}

export async function markAllAsReadAction() {
  const context = await requireUser("/dashboard/notifications");
  const [t, locale] = await Promise.all([getTranslations("dashboard"), getLocale()]);

  try {
    await markAllAsRead(context.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("common.somethingWentWrong");
    return redirect({ href: withStatus("/dashboard/notifications", "error", message), locale });
  }

  return redirect({ href: "/dashboard/notifications", locale });
}
