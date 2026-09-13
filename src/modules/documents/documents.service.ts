import { randomUUID } from "node:crypto";

import { documentsConfig } from "@/config/documents";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type DocumentUpload = Database["public"]["Tables"]["document_uploads"]["Row"];
export type Document = Database["public"]["Tables"]["documents"]["Row"];

const RECENT_LIST_LIMIT = 50;

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-150);
}

type UploadIntentInput = { filename: string; size: number; mimeType: string };
type UploadIntentResult = { uploadId: string; signedUrl: string; token: string; path: string };

// specs/01-architecture.md §Upload step 1. The user's own RLS-scoped client does the
// document_uploads insert (so has_organization_write_access() rejects a read-only member for
// free); the admin client generates the signed URL, since storage.objects has no RLS grant for
// authenticated users at all (this migration's own comment — the token is the auth mechanism).
export async function createUploadIntent(
  userId: string,
  organizationId: string,
  input: UploadIntentInput
): Promise<UploadIntentResult> {
  if (input.size <= 0 || input.size > documentsConfig.maxSizeBytes) {
    throw new ValidationError(
      `File size must be between 1 byte and ${documentsConfig.maxSizeBytes} bytes`
    );
  }
  if (!documentsConfig.allowedMimeTypes.includes(input.mimeType)) {
    throw new ValidationError(`File type is not allowed: ${input.mimeType}`);
  }

  const path = `${organizationId}/${randomUUID()}-${sanitizeFilename(input.filename)}`;
  const expiresAt = new Date(
    Date.now() + documentsConfig.pendingExpiryMinutes * 60 * 1000
  ).toISOString();

  const db = await createClient();
  const { data: upload, error: insertError } = await db
    .from("document_uploads")
    .insert({
      organization_id: organizationId,
      storage_path: path,
      filename: input.filename,
      declared_mime_type: input.mimeType,
      size_bytes: input.size,
      created_by: userId,
      expires_at: expiresAt
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(documentsConfig.bucket)
    .createSignedUploadUrl(path);

  if (signError) {
    // Compensating cleanup — the row would otherwise sit 'pending' with no way to ever upload.
    await db.from("document_uploads").delete().eq("id", upload.id);
    throw signError;
  }

  return { uploadId: upload.id, signedUrl: signed.signedUrl, token: signed.token, path };
}

// specs/01-architecture.md §Upload steps 2-3. Confirms the object actually landed in storage
// (never trust the client's say-so) before handing off to the worker pipeline.
export async function completeUpload(userId: string, uploadId: string): Promise<DocumentUpload> {
  const db = await createClient();
  const { data: upload, error } = await db
    .from("document_uploads")
    .select("*")
    .eq("id", uploadId)
    .maybeSingle();

  if (error) throw error;
  if (!upload) throw new NotFoundError("Upload not found");
  if (upload.created_by !== userId) {
    throw new AuthorizationError("You can only complete your own uploads");
  }
  if (upload.status !== "pending") {
    throw new ValidationError(`Upload is not pending (status: ${upload.status})`);
  }

  const admin = createAdminClient();
  const dir = upload.storage_path.split("/").slice(0, -1).join("/");
  const filename = upload.storage_path.split("/").at(-1) ?? "";
  const { data: listing, error: listError } = await admin.storage
    .from(documentsConfig.bucket)
    .list(dir, { search: filename });

  if (listError) throw listError;
  if (!listing.some((f) => f.name === filename)) {
    throw new ValidationError("File was not found in storage — upload may have failed or expired");
  }

  const { data: updated, error: updateError } = await admin
    .from("document_uploads")
    .update({ status: "uploaded" })
    .eq("id", uploadId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  await enqueue(QUEUE_NAMES.validateUpload, {
    orgId: upload.organization_id,
    uploadId: upload.id
  });

  return updated;
}

// Minimal listing for the Phase 1 documents page — RLS (documents_select_member) does the only
// authorization that matters here. specs/02-data-model.md's full mixed-filter listDocuments()
// (type/date/entity/status/full-text `q`) is Phase 2 work; this just orders by recency.
export async function listDocuments(organizationId: string): Promise<Document[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIST_LIMIT);

  if (error) throw error;
  return data;
}

// Surfaces the upload pipeline's in-flight/failed state (validating, submitting, processing,
// failed) that has no row in `documents` yet — without this, an upload sits invisible between
// "upload-complete returned" and "sync-paperless-document.ts finishes."
export async function listRecentUploads(organizationId: string): Promise<DocumentUpload[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("document_uploads")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIST_LIMIT);

  if (error) throw error;
  return data;
}
