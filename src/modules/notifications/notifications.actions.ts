"use server";

import { redirect } from "next/navigation";

import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { markAllAsRead, markAsRead } from "@/modules/notifications/notifications.service";

function redirectWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus("/dashboard/notifications", "error", message));
}

export async function markAsReadAction(formData: FormData) {
  const context = await requireUser("/dashboard/notifications");
  const notificationId = formData.get("notificationId");

  if (typeof notificationId !== "string") {
    redirect(withStatus("/dashboard/notifications", "error", "Missing notification"));
  }

  try {
    await markAsRead(notificationId, context.user.id);
  } catch (error) {
    redirectWithError(error);
  }

  redirect("/dashboard/notifications");
}

export async function markAllAsReadAction() {
  const context = await requireUser("/dashboard/notifications");

  try {
    await markAllAsRead(context.user.id);
  } catch (error) {
    redirectWithError(error);
  }

  redirect("/dashboard/notifications");
}
