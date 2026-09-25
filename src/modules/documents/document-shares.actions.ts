"use server";

import { getTranslations } from "next-intl/server";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import {
  shareDocumentSchema,
  unshareDocumentSchema
} from "@/modules/documents/document-shares.schemas";
import {
  getDocumentPermissions,
  loadDocumentPermissions,
  shareDocument,
  unshareDocument,
  type DocumentPermissions,
  type PermissionsResult
} from "@/modules/documents/document-shares.service";
import { getDocumentRow } from "@/modules/documents/documents.service";
import { createNotification } from "@/modules/notifications/notifications.service";

// These skip buildRequestContext() on purpose: it resolves the active organization first (a
// measured extra round trip), and the sharing functions scope themselves by document id + auth.
// Each mutation returns the refreshed permissions so the tab never needs a second request.

export async function shareDocumentAction(input: unknown): Promise<DocumentPermissions> {
  requireFeature("documents");
  const parsed = shareDocumentSchema.parse(input);
  const { user, profile } = await requireUser();
  const db = await createClient();
  await shareDocument(db, parsed);

  const [permissions] = await Promise.all([
    getDocumentPermissions(db, parsed.documentId),
    // An everyone-grant doesn't notify anyone (it would spam the whole organization).
    parsed.userId === null
      ? Promise.resolve()
      : notifyRecipient(parsed.userId, parsed.documentId, parsed.permission, profile?.name ?? user.email)
  ]);
  return permissions;
}

export async function unshareDocumentAction(input: unknown): Promise<DocumentPermissions> {
  requireFeature("documents");
  const parsed = unshareDocumentSchema.parse(input);
  await requireUser();
  const db = await createClient();
  await unshareDocument(db, parsed);
  return getDocumentPermissions(db, parsed.documentId);
}

// Client-callable read used by the file-level actions menu (listings + folder explorer) to open
// the permissions dialog on demand. Returns the never-rejecting PermissionsResult shape the
// DocumentPermissionsTab already consumes, so a document the caller can't see degrades to the
// tab's own error state rather than an unhandled rejection.
export async function getDocumentPermissionsAction(documentId: string): Promise<PermissionsResult> {
  requireFeature("documents");
  await requireUser();
  return loadDocumentPermissions(documentId);
}

// Best-effort — the grant is already committed (with its audit row) by the RPC; a failed
// notification must not fail or roll back the share, but it is logged, not swallowed.
async function notifyRecipient(
  recipientId: string,
  documentId: string,
  permission: "view" | "edit",
  sharerName: string | null | undefined
): Promise<void> {
  try {
    const [t, document] = await Promise.all([
      getTranslations("documents.share"),
      getDocumentRow(documentId)
    ]);
    await createNotification(recipientId, {
      type: "document.shared",
      title: t("notificationTitle"),
      message: t("notificationMessage", {
        name: sharerName ?? t("someone"),
        title: document.title,
        permission: t(`permission.${permission}`)
      }),
      metadata: { documentId, permission }
    });
  } catch (error) {
    logger.error("documents.share_notify_failed", {
      documentId,
      errorMessage: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
