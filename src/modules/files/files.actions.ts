"use server";

import { redirect } from "next/navigation";

import { requireFeature } from "@/modules/auth/authorization";
import { withStatus } from "@/modules/auth/redirects";
import { requireUser } from "@/modules/auth/session";
import { deleteFile, uploadAvatar, uploadFile } from "@/modules/files/files.service";

function redirectWithError(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(withStatus(path, "error", message));
}

async function readUploadedFile(formData: FormData): Promise<{
  buffer: Buffer;
  filename: string;
  declaredMimeType: string;
  size: number;
} | null> {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return null;
  }

  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
    declaredMimeType: file.type || "application/octet-stream",
    size: file.size
  };
}

export async function uploadFileAction(formData: FormData) {
  requireFeature("files");
  const context = await requireUser("/dashboard/files");
  const upload = await readUploadedFile(formData);

  if (!upload) {
    redirect(withStatus("/dashboard/files", "error", "Choose a file to upload"));
  }

  try {
    await uploadFile(context, upload);
  } catch (error) {
    redirectWithError("/dashboard/files", error);
  }

  redirect("/dashboard/files");
}

export async function deleteFileAction(formData: FormData) {
  requireFeature("files");
  const context = await requireUser("/dashboard/files");
  const fileId = formData.get("fileId");

  if (typeof fileId !== "string") {
    redirect(withStatus("/dashboard/files", "error", "Missing file"));
  }

  try {
    await deleteFile(context, fileId);
  } catch (error) {
    redirectWithError("/dashboard/files", error);
  }

  redirect("/dashboard/files");
}

export async function uploadAvatarAction(formData: FormData) {
  requireFeature("files");
  const context = await requireUser("/settings/profile");
  const upload = await readUploadedFile(formData);

  if (!upload) {
    redirect(withStatus("/settings/profile", "error", "Choose an image to upload"));
  }

  try {
    await uploadAvatar(context, upload);
  } catch (error) {
    redirectWithError("/settings/profile", error);
  }

  redirect("/settings/profile");
}
