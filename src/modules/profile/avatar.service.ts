import { avatarConfig } from "@/config/avatar";
import { logEvent } from "@/lib/events";
import { validateFileAgainstConfig } from "@/lib/files/validate";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/modules/auth/session";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp"
};

function extractAvatarPath(publicUrl: string | null, bucket: string): string | null {
  if (!publicUrl) {
    return null;
  }

  const marker = `/object/public/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  return index === -1 ? null : publicUrl.slice(index + marker.length);
}

export async function uploadAvatar(
  actor: AuthContext,
  input: { buffer: Buffer; declaredMimeType: string; size: number }
): Promise<string> {
  const mimeType = validateFileAgainstConfig(input, avatarConfig);
  const extension = EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin";
  const path = `${actor.user.id}/avatar-${Date.now()}.${extension}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(avatarConfig.bucket)
    .upload(path, input.buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } = admin.storage.from(avatarConfig.bucket).getPublicUrl(path);
  const previousAvatarUrl = actor.profile?.avatar_url ?? null;

  const { error: updateError } = await admin
    .from("profiles")
    .update({ avatar_url: publicUrlData.publicUrl })
    .eq("id", actor.user.id);

  if (updateError) {
    await admin.storage.from(avatarConfig.bucket).remove([path]);
    throw updateError;
  }

  const previousPath = extractAvatarPath(previousAvatarUrl, avatarConfig.bucket);
  if (previousPath) {
    await admin.storage.from(avatarConfig.bucket).remove([previousPath]);
  }

  await logEvent({
    actorId: actor.user.id,
    action: "avatar.uploaded",
    entityType: "profile",
    entityId: actor.user.id
  });

  return publicUrlData.publicUrl;
}
