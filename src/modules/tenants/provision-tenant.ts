import { randomBytes } from "node:crypto";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { paperlessAdminClient, type PaperlessClient } from "@/lib/paperless/client";
import { encryptPaperlessToken } from "@/lib/paperless/token-crypto";
import { TENANT_MODEL_PERMISSIONS } from "@/lib/paperless/types";
import { createAdminClient } from "@/lib/supabase/admin";

// Names only, not Slovenian labels — specs/04-level-0-foundation.md gives these as the literal
// list.
const DEFAULT_DOCUMENT_TYPES = ["Invoice", "Contract", "Service report", "Quotation"] as const;

const DEFAULT_STORAGE_PATH_NAME = "Default";
const DEFAULT_STORAGE_PATH_TEMPLATE = "{{ created_year }}/{{ document_type }}/{{ title }}";

function randomPassword(): string {
  return randomBytes(24).toString("base64url");
}

// name__iexact confirmed against a live instance — plain ?name= is not an exact filter and
// silently returns everything.
export async function findOrCreateGroup(admin: PaperlessClient, orgId: string): Promise<number> {
  const name = `tenant_${orgId}`;
  const existing = await admin.get<{ results: Array<{ id: number }> }>(
    `/api/groups/?name__iexact=${encodeURIComponent(name)}`
  );
  if (existing.results[0]) return existing.results[0].id;

  const created = await admin.post<{ id: number }>("/api/groups/", {
    name,
    permissions: TENANT_MODEL_PERMISSIONS
  });
  return created.id;
}

// Existing users found on retry always get a fresh password + login — we never persist the
// plaintext password, so there is no other way to re-authenticate as a reused service user.
export async function findOrCreateServiceUser(
  admin: PaperlessClient,
  orgId: string,
  groupId: number
): Promise<{ userId: number; token: string }> {
  const username = `svc_${orgId}`;
  const password = randomPassword();

  const existing = await admin.get<{ results: Array<{ id: number }> }>(
    `/api/users/?username__iexact=${encodeURIComponent(username)}`
  );

  let userId: number;
  if (existing.results[0]) {
    userId = existing.results[0].id;
    await admin.patch(`/api/users/${userId}/`, { password, groups: [groupId] });
  } else {
    const created = await admin.post<{ id: number }>("/api/users/", {
      username,
      password,
      is_staff: false,
      is_superuser: false,
      groups: [groupId]
    });
    userId = created.id;
  }

  const loginRes = await admin.post<{ token: string }>("/api/token/", { username, password });
  return { userId, token: loginRes.token };
}

export async function findOrCreateDocumentType(
  admin: PaperlessClient,
  name: string,
  ownerId: number,
  groupId: number
): Promise<number> {
  const existing = await admin.get<{ results: Array<{ id: number }> }>(
    `/api/document_types/?name__iexact=${encodeURIComponent(name)}`
  );
  if (existing.results[0]) return existing.results[0].id;

  const created = await admin.createOwnedObject<{ id: number }>(
    "/api/document_types/",
    { name },
    { ownerId, groupId }
  );
  return created.id;
}

export async function findOrCreateStoragePath(
  admin: PaperlessClient,
  ownerId: number,
  groupId: number
): Promise<number> {
  const existing = await admin.get<{ results: Array<{ id: number }> }>(
    `/api/storage_paths/?name__iexact=${encodeURIComponent(DEFAULT_STORAGE_PATH_NAME)}`
  );
  if (existing.results[0]) return existing.results[0].id;

  const created = await admin.createOwnedObject<{ id: number }>(
    "/api/storage_paths/",
    { name: DEFAULT_STORAGE_PATH_NAME, path: DEFAULT_STORAGE_PATH_TEMPLATE },
    { ownerId, groupId }
  );
  return created.id;
}

/**
 * specs/01-architecture.md §Provisioning a tenant. Idempotent via find-or-create at every
 * Paperless-side step (name__iexact lookup before create) rather than delete-based
 * compensating cleanup on failure — a partial run just leaves state the next retry discovers
 * and resumes from, which is simpler and safer than trying to undo partially-completed
 * external API calls. The one exception is the service user's password, which is always reset
 * on a retry (see findOrCreateServiceUser) since we never persist the plaintext.
 *
 * Concurrency: claimed via a conditional UPDATE on provisioning_status (pending/
 * provisioning_failed -> provisioning) rather than a Postgres advisory lock — session-scoped
 * advisory locks aren't safe over PostgREST's pooled, per-request connections (lock and unlock
 * could land on different pooled connections), and this job's real work spans external
 * Paperless API calls between DB round-trips anyway, so a lock held only for the duration of
 * one RPC call wouldn't cover the actual race.
 */
export async function provisionTenant(orgId: string): Promise<void> {
  const db = createAdminClient();

  const { data: claimed, error: claimError } = await db.rpc("claim_provisioning", {
    p_organization_id: orgId
  });

  if (claimError) throw claimError;
  if (!claimed) {
    logger.info("tenants.provision.skipped_not_claimable", { orgId });
    return;
  }

  try {
    const admin = await paperlessAdminClient();

    const groupId = await findOrCreateGroup(admin, orgId);
    const { userId, token } = await findOrCreateServiceUser(admin, orgId, groupId);

    const documentTypeIds = await Promise.all(
      DEFAULT_DOCUMENT_TYPES.map((name) => findOrCreateDocumentType(admin, name, userId, groupId))
    );
    const storagePathId = await findOrCreateStoragePath(admin, userId, groupId);

    const objectMap = documentTypeIds.map((paperlessId) => ({
      object_type: "document_type",
      paperless_id: paperlessId
    }));
    objectMap.push({ object_type: "storage_path", paperless_id: storagePathId });

    const encryptedToken = encryptPaperlessToken(token);

    const { error: rpcError } = await db.rpc("complete_provisioning", {
      p_organization_id: orgId,
      p_base_url: env.PAPERLESS_ADMIN_URL ?? "",
      p_service_user_id: userId,
      p_group_id: groupId,
      // supabase-js encodes a Buffer as \x-hex text for a bytea param — same format
      // decodePostgresBytea() in client.ts already reads back out.
      p_api_token_encrypted: `\\x${encryptedToken.toString("hex")}`,
      p_storage_path_id: storagePathId,
      p_object_map: objectMap
    });
    if (rpcError) throw rpcError;

    logger.info("tenants.provision.completed", { orgId, groupId, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("tenants.provision.failed", { orgId, errorMessage: message });
    const { error: failError } = await db.rpc("fail_provisioning", {
      p_organization_id: orgId,
      p_reason: message.slice(0, 500)
    });
    if (failError) {
      logger.error("tenants.provision.fail_provisioning_rpc_failed", {
        orgId,
        errorMessage: failError.message
      });
    }
    throw err;
  }
}
