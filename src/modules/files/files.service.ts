import { randomUUID } from "node:crypto";

import { can } from "@/modules/auth/authorization";
import type { AuthContext } from "@/modules/auth/session";
import { isFeatureEnabled } from "@/config/features";
import { type FileCategory, filesConfig } from "@/config/files";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { validateFile } from "@/lib/files/validate";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { getMembership } from "@/modules/organizations/organizations.service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type FileRecord = Database["public"]["Tables"]["files"]["Row"];

const DEFAULT_PAGE_SIZE = 20;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv"
};

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}

async function resolveOwnerOrganizationId(actor: AuthContext): Promise<string | null> {
  if (!isFeatureEnabled("organizations")) {
    return null;
  }

  return getActiveOrganizationId(actor.user.id);
}

export async function uploadFile(
  actor: AuthContext,
  input: { buffer: Buffer; filename: string; declaredMimeType: string; size: number }
): Promise<FileRecord> {
  const category: FileCategory = "document";
  const mimeType = validateFile(
    { buffer: input.buffer, declaredMimeType: input.declaredMimeType, size: input.size },
    category
  );
  const config = filesConfig.categories[category];
  const organizationId = await resolveOwnerOrganizationId(actor);
  const path = `${organizationId ?? actor.user.id}/${randomUUID()}-${sanitizeFilename(input.filename)}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(config.bucket)
    .upload(path, input.buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    throw uploadError;
  }

  const { data, error: insertError } = await admin
    .from("files")
    .insert({
      owner_id: actor.user.id,
      organization_id: organizationId,
      bucket: config.bucket,
      path,
      filename: input.filename,
      mime_type: mimeType,
      size: input.size
    })
    .select("*")
    .single();

  if (insertError) {
    await admin.storage.from(config.bucket).remove([path]);
    throw insertError;
  }

  return data;
}

export async function uploadAvatar(
  actor: AuthContext,
  input: { buffer: Buffer; declaredMimeType: string; size: number }
): Promise<string> {
  const category: FileCategory = "avatar";
  const mimeType = validateFile(
    { buffer: input.buffer, declaredMimeType: input.declaredMimeType, size: input.size },
    category
  );
  const config = filesConfig.categories[category];
  const extension = EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin";
  const path = `${actor.user.id}/avatar-${Date.now()}.${extension}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(config.bucket)
    .upload(path, input.buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } = admin.storage.from(config.bucket).getPublicUrl(path);
  const previousAvatarUrl = actor.profile?.avatar_url ?? null;

  const { error: updateError } = await admin
    .from("profiles")
    .update({ avatar_url: publicUrlData.publicUrl })
    .eq("id", actor.user.id);

  if (updateError) {
    await admin.storage.from(config.bucket).remove([path]);
    throw updateError;
  }

  const previousPath = extractAvatarPath(previousAvatarUrl, config.bucket);
  if (previousPath) {
    await admin.storage.from(config.bucket).remove([previousPath]);
  }

  return publicUrlData.publicUrl;
}

function extractAvatarPath(publicUrl: string | null, bucket: string): string | null {
  if (!publicUrl) {
    return null;
  }

  const marker = `/object/public/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  return index === -1 ? null : publicUrl.slice(index + marker.length);
}

export async function listFiles(
  options: { cursor?: string | null; limit?: number } = {}
): Promise<{ items: FileRecord[]; nextCursor: string | null }> {
  const supabase = await createClient();
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = decodeCursor(options.cursor);

  let query = supabase
    .from("files")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null
  };
}

async function canManageFile(actor: AuthContext, file: FileRecord): Promise<boolean> {
  if (file.owner_id === actor.user.id) {
    return true;
  }

  if (!file.organization_id) {
    return false;
  }

  const membership = await getMembership(file.organization_id, actor.user.id);
  return membership ? can(membership.role, "organization.files.manage") : false;
}

export async function deleteFile(actor: AuthContext, fileId: string): Promise<void> {
  const supabase = await createClient();
  const { data: file, error } = await supabase.from("files").select("*").eq("id", fileId).maybeSingle();

  if (error) {
    throw error;
  }

  if (!file) {
    throw new NotFoundError("File not found");
  }

  if (!(await canManageFile(actor, file))) {
    throw new AuthorizationError("You are not allowed to delete this file");
  }

  const admin = createAdminClient();
  const { error: removeError } = await admin.storage.from(file.bucket).remove([file.path]);

  if (removeError) {
    throw removeError;
  }

  const { error: deleteError } = await admin.from("files").delete().eq("id", fileId);

  if (deleteError) {
    throw deleteError;
  }
}

export async function getFileDownloadUrl(fileId: string): Promise<string> {
  const supabase = await createClient();
  const { data: file, error } = await supabase.from("files").select("*").eq("id", fileId).maybeSingle();

  if (error) {
    throw error;
  }

  if (!file) {
    throw new NotFoundError("File not found");
  }

  const admin = createAdminClient();
  const { data, error: signError } = await admin.storage
    .from(file.bucket)
    .createSignedUrl(file.path, filesConfig.signedUrlExpirySeconds);

  if (signError) {
    throw signError;
  }

  return data.signedUrl;
}
