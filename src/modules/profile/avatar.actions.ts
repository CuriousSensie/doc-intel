"use server";

import { redirect } from "next/navigation";

import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { uploadAvatar } from "@/modules/profile/avatar.service";

function redirectWithError(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus(path, "error", message));
}

export async function uploadAvatarAction(formData: FormData) {
  const context = await requireUser("/settings/profile");
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect(withStatus("/settings/profile", "error", "Choose an image to upload"));
  }

  try {
    await uploadAvatar(context, {
      buffer: Buffer.from(await file.arrayBuffer()),
      declaredMimeType: file.type || "application/octet-stream",
      size: file.size
    });
  } catch (error) {
    redirectWithError("/settings/profile", error);
  }

  redirect("/settings/profile");
}
