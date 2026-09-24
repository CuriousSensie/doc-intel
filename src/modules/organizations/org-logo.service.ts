import { orgLogoConfig } from "@/config/org-logo";
import { logEvent } from "@/lib/events";
import { validateFileAgainstConfig } from "@/lib/files/validate";
import { createAdminClient } from "@/lib/supabase/admin";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp"
};

function extractLogoPath(publicUrl: string | null, bucket: string): string | null {
  if (!publicUrl) {
    return null;
  }

  const marker = `/object/public/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  return index === -1 ? null : publicUrl.slice(index + marker.length);
}

// Mirrors src/modules/profile/avatar.service.ts uploadAvatar() — same bucket-per-owner-id
// path shape, same replace-on-update cleanup, different owner (organization, not user) and
// different table.
export async function uploadOrganizationLogo(
  actorId: string,
  organizationId: string,
  input: { buffer: Buffer; declaredMimeType: string; size: number }
): Promise<string> {
  const mimeType = validateFileAgainstConfig(input, orgLogoConfig);
  const extension = EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin";
  const path = `${organizationId}/logo-${Date.now()}.${extension}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(orgLogoConfig.bucket)
    .upload(path, input.buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    throw uploadError;
  }

  const { data: currentOrg, error: currentOrgError } = await admin
    .from("organizations")
    .select("logo_url")
    .eq("id", organizationId)
    .single();

  if (currentOrgError) {
    await admin.storage.from(orgLogoConfig.bucket).remove([path]);
    throw currentOrgError;
  }

  const { data: publicUrlData } = admin.storage.from(orgLogoConfig.bucket).getPublicUrl(path);

  const { error: updateError } = await admin
    .from("organizations")
    .update({ logo_url: publicUrlData.publicUrl })
    .eq("id", organizationId);

  if (updateError) {
    await admin.storage.from(orgLogoConfig.bucket).remove([path]);
    throw updateError;
  }

  const previousPath = extractLogoPath(currentOrg.logo_url, orgLogoConfig.bucket);
  if (previousPath) {
    await admin.storage.from(orgLogoConfig.bucket).remove([previousPath]);
  }

  await logEvent({
    actorId,
    action: "organization.logo_uploaded",
    entityType: "organization",
    entityId: organizationId,
    organizationId
  });

  return publicUrlData.publicUrl;
}
