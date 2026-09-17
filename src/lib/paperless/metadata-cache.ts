import { getRedisClient } from "@/lib/redis";

import type { PaperlessClient } from "./client";
import {
  getPaperlessCorrespondentName,
  getPaperlessDocumentTypeName,
  listPaperlessCorrespondents,
  listPaperlessDocumentTypes,
  listPaperlessTags,
  type PaperlessCorrespondent,
  type PaperlessDocumentType,
  type PaperlessTag
} from "./documents";

// sync-paperless-document.ts calls these per document — an import of 5,000 invoices from one
// correspondent would otherwise issue 5,000 identical GET /api/correspondents/{id}/ calls
// (found reading the Phase 2 code, before any importer existed to make it visible). Redis,
// short TTL: a rename in Paperless is picked up within TTL_SECONDS, never stale forever.
const TTL_SECONDS = 5 * 60;

async function cached(
  orgId: string,
  kind: "correspondent" | "document_type",
  id: number,
  fetch: () => Promise<string>
): Promise<string> {
  const redis = getRedisClient();
  const key = `paperless:meta:${kind}:${orgId}:${id}`;

  const hit = await redis.get(key);
  if (hit !== null) return hit;

  const value = await fetch();
  await redis.set(key, value, "EX", TTL_SECONDS);
  return value;
}

export function getCachedCorrespondentName(
  client: PaperlessClient,
  orgId: string,
  correspondentId: number
): Promise<string> {
  return cached(orgId, "correspondent", correspondentId, () =>
    getPaperlessCorrespondentName(client, correspondentId)
  );
}

export function getCachedDocumentTypeName(
  client: PaperlessClient,
  orgId: string,
  documentTypeId: number
): Promise<string> {
  return cached(orgId, "document_type", documentTypeId, () =>
    getPaperlessDocumentTypeName(client, documentTypeId)
  );
}

// The documents filter bar's option lists — fetched on every page render, so worth the same
// short-TTL cache as the per-id lookups above rather than a live Paperless call on every load.
async function cachedList<T>(
  orgId: string,
  kind: "tags" | "correspondents" | "document_types",
  fetch: () => Promise<T[]>
): Promise<T[]> {
  const redis = getRedisClient();
  const key = `paperless:meta:list:${kind}:${orgId}`;

  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T[];

  const value = await fetch();
  await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  return value;
}

async function updateCachedList<T extends { id: number }>(
  orgId: string,
  kind: "tags" | "correspondents" | "document_types",
  item: T
): Promise<void> {
  const redis = getRedisClient();
  const key = `paperless:meta:list:${kind}:${orgId}`;
  const hit = await redis.get(key);
  if (hit === null) return;

  const list = JSON.parse(hit) as T[];
  const next = [...list.filter((existing) => existing.id !== item.id), item].sort((a, b) =>
    "name" in a && "name" in b ? String(a.name).localeCompare(String(b.name)) : a.id - b.id
  );
  await redis.set(key, JSON.stringify(next), "EX", TTL_SECONDS);
}

export function getCachedTags(client: PaperlessClient, orgId: string): Promise<PaperlessTag[]> {
  return cachedList(orgId, "tags", () => listPaperlessTags(client));
}

export function getCachedCorrespondents(
  client: PaperlessClient,
  orgId: string
): Promise<PaperlessCorrespondent[]> {
  return cachedList(orgId, "correspondents", () => listPaperlessCorrespondents(client));
}

export function getCachedDocumentTypes(
  client: PaperlessClient,
  orgId: string
): Promise<PaperlessDocumentType[]> {
  return cachedList(orgId, "document_types", () => listPaperlessDocumentTypes(client));
}

export function addCachedTag(orgId: string, tag: PaperlessTag): Promise<void> {
  return updateCachedList(orgId, "tags", tag);
}

export function addCachedCorrespondent(
  orgId: string,
  correspondent: PaperlessCorrespondent
): Promise<void> {
  return updateCachedList(orgId, "correspondents", correspondent);
}

export function addCachedDocumentType(
  orgId: string,
  documentType: PaperlessDocumentType
): Promise<void> {
  return updateCachedList(orgId, "document_types", documentType);
}

export async function invalidateCachedMetadataList(
  orgId: string,
  kind: "tags" | "correspondents" | "document_types"
): Promise<void> {
  const redis = getRedisClient();
  await redis.del(`paperless:meta:list:${kind}:${orgId}`);
}
