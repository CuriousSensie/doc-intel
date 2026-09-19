import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import { createClient } from "@/lib/supabase/server";

type Db = ServiceContext["db"];

export type DocumentPermission = "view" | "edit";

export type DocumentShare = {
  id: string;
  // null = everyone in the organization
  userId: string | null;
  permission: DocumentPermission;
  createdAt: string;
  name: string | null;
  email: string | null;
};

export type ShareableMember = {
  userId: string;
  name: string | null;
  email: string;
  isReadOnly: boolean;
};

export type DocumentPerson = { name: string | null; email: string | null };

// owner = the organization's owner (always has access); createdBy = the member who uploaded it,
// null for documents synced outside the upload flow.
export type DocumentPermissions = {
  owner: DocumentPerson | null;
  createdBy: DocumentPerson | null;
  canManage: boolean;
  currentUserId: string;
  shares: DocumentShare[];
  // Only populated for someone who can manage the document.
  members: ShareableMember[];
};

export type PermissionsResult =
  | { ok: true; data: DocumentPermissions }
  | { ok: false; message: string };

// Postgres `raise exception` inside the sharing functions (P0001) carries a message meant for the
// user ("Recipient must be a member…") — surface it as a validation error. P0002 is what
// get_document_permissions raises for a document the caller can't see.
const RAISE_EXCEPTION = "P0001";
const NO_DATA_FOUND = "P0002";

// One database round trip (get_document_permissions) instead of the ~10 queries this used to be
// stitched from — the Permissions tab was visibly slow.
export async function getDocumentPermissions(
  db: Db,
  documentId: string
): Promise<DocumentPermissions> {
  const { data, error } = await db.rpc("get_document_permissions", { p_document_id: documentId });

  if (error) {
    throw error.code === NO_DATA_FOUND ? new NotFoundError("Document not found") : error;
  }
  return data as unknown as DocumentPermissions;
}

// Never rejects: the page starts this without awaiting it and streams the result to the tab, and
// an unhandled rejection there would take the whole details page down instead of one tab.
export async function loadDocumentPermissions(documentId: string): Promise<PermissionsResult> {
  try {
    return { ok: true, data: await getDocumentPermissions(await createClient(), documentId) };
  } catch (error) {
    // Supabase errors are sometimes plain objects, not Error instances.
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "Unknown error";
    return { ok: false, message };
  }
}

export async function shareDocument(
  db: Db,
  input: { documentId: string; userId: string | null; permission: DocumentPermission }
): Promise<void> {
  const { error } = await db.rpc("share_document", {
    p_document_id: input.documentId,
    p_user_id: input.userId,
    p_permission: input.permission
  });

  if (error) {
    throw error.code === RAISE_EXCEPTION ? new ValidationError(error.message) : error;
  }
}

export async function unshareDocument(
  db: Db,
  input: { documentId: string; userId: string | null }
): Promise<void> {
  const { error } = await db.rpc("unshare_document", {
    p_document_id: input.documentId,
    p_user_id: input.userId
  });

  if (error) {
    throw error.code === RAISE_EXCEPTION ? new ValidationError(error.message) : error;
  }
}
