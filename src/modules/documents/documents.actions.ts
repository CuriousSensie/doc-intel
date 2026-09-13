"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
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

export async function getDocumentAction(documentId: string) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return getDocument(ctx.orgId, documentId);
}

export async function getDocumentHistoryAction(documentId: string) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return getDocumentHistory(ctx.orgId, documentId);
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
