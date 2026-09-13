"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import {
  getDocument,
  getDocumentHistory,
  listDocuments,
  updateDocument,
  type ListDocumentsOptions
} from "@/modules/documents/documents.service";

export async function listDocumentsAction(options: ListDocumentsOptions = {}) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return listDocuments(ctx.orgId, options);
}

// No buildRequestContext() here on purpose — that resolves an active org first (a real, measured
// round trip), which getDocument()/getDocumentHistory() don't need: RLS scopes the read by
// itself. requireUser() alone is enough (auth only, no org resolution).
export async function getDocumentAction(documentId: string) {
  requireFeature("documents");
  await requireUser();
  return getDocument(documentId);
}

export async function getDocumentHistoryAction(documentId: string) {
  requireFeature("documents");
  await requireUser();
  return getDocumentHistory(documentId);
}

export async function updateDocumentAction(
  documentId: string,
  input: {
    title?: string;
    documentDate?: string;
    documentTypeId?: number | null;
    customFieldValues?: Array<{ field: number; value: unknown }>;
  }
) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  if (!ctx.actorId) throw new Error("updateDocumentAction requires an authenticated actor");
  return updateDocument(ctx.actorId, ctx.orgId, documentId, input);
}
