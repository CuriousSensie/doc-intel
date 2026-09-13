import { OrgNotProvisionedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";

import { mapPaperlessError, isRetryablePaperlessError } from "./errors";
import { decryptPaperlessToken } from "./token-crypto";
import type { PaperlessSetPermissions } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

type RequestOptions = {
  method?: string;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
  // Retried with backoff on 5xx/network failure. Never set for a non-idempotent POST.
  idempotent?: boolean;
};

type PaperlessCredentials = { baseUrl: string; token: string };

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// PostgREST returns bytea as hex (\x...) — strip the prefix before decoding.
function decodePostgresBytea(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}

// undici wraps connection-level failures (ECONNREFUSED, ENOTFOUND, etc.) as an AggregateError
// with an empty top-level .message — the real detail is one level deeper, in .errors[].
function describeErrorCause(cause: unknown): string | undefined {
  if (cause instanceof AggregateError) {
    return cause.errors
      .map((e: unknown) => (e instanceof Error ? e.message : String(e)))
      .join("; ");
  }
  if (cause instanceof Error) return cause.message;
  if (cause !== undefined) return String(cause);
  return undefined;
}

// No default — makes isolation test #20 ("no creation without explicit permissions") a
// compile-time guarantee, not just a convention.
export type OwnedObjectPermissions = { ownerId: number; groupId: number };

class PaperlessRequestError extends Error {
  constructor(
    public res: Response | null,
    public cause: unknown
  ) {
    super("Paperless request failed");
  }
}

// No unscoped or superuser variant here — see paperlessAdminClient() below.
export class PaperlessClient {
  constructor(
    private readonly orgId: string,
    private readonly creds: PaperlessCredentials,
    // null for the admin client; set for tenant clients so createOwnedObject() can reject a
    // mismatched owner/group instead of silently creating a cross-tenant leak.
    private readonly expectedOwnership: OwnedObjectPermissions | null
  ) {}

  // null only for the admin client — every tenant client (paperlessFor()) always has one.
  get ownership(): OwnedObjectPermissions | null {
    return this.expectedOwnership;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = "GET",
      body,
      form,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      idempotent = method === "GET"
    } = options;
    const attempts = idempotent ? MAX_RETRIES : 1;

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = { Authorization: `Token ${this.creds.token}` };
        if (!form) headers["Content-Type"] = "application/json";

        const res = await fetch(`${this.creds.baseUrl}${path}`, {
          method,
          headers,
          body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
          signal: controller.signal
        });

        const durationMs = Date.now() - start;
        logger.info("paperless.request", {
          orgId: this.orgId,
          method,
          path,
          status: res.status,
          durationMs
        });

        if (!res.ok) {
          if (isRetryablePaperlessError(res, null) && attempt < attempts) {
            lastError = new PaperlessRequestError(res, null);
            await this.backoff(attempt);
            continue;
          }
          throw await mapPaperlessError(res, { orgId: this.orgId, path });
        }

        if (res.status === 204) return undefined as T;
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) return (await res.json()) as T;
        return (await res.text()) as unknown as T;
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof PaperlessRequestError || !(err instanceof Error)) throw err;

        const durationMs = Date.now() - start;
        logger.error("paperless.request_failed", {
          orgId: this.orgId,
          method,
          path,
          durationMs,
          errorMessage: err.message,
          // err.message is frequently just the unhelpful generic "fetch failed" for undici
          // errors — found live, diagnosing a real post_document/ failure that gave no other
          // signal: the actual reason is nested under .cause, and for a connection-level
          // failure .cause is itself an AggregateError (e.g. ECONNREFUSED) whose own .message
          // is empty — the real detail is in .cause.errors[].
          errorCause: describeErrorCause(err.cause)
        });

        if (isRetryablePaperlessError(null, err) && attempt < attempts) {
          lastError = err;
          await this.backoff(attempt);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Paperless request failed after retries");
  }

  private async backoff(attempt: number) {
    const base = 300 * 2 ** (attempt - 1);
    const jitter = Math.random() * base * 0.5;
    await sleep(base + jitter);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { idempotent: true });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body });
  }

  // Plain POST for objects with no owner/ACL concept (groups, users) — every tenant-owned
  // object goes through createOwnedObject() below instead.
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  delete(path: string): Promise<void> {
    return this.request<void>(path, { method: "DELETE" });
  }

  postForm<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>(path, { method: "POST", form, timeoutMs: UPLOAD_TIMEOUT_MS });
  }

  // Shared by createOwnedObject() and setOwnedObjectPermissions() — the one guard that makes
  // isolation test #20 ("no creation/grant without explicit, tenant-matching permissions") a
  // compile-time-adjacent guarantee instead of a convention two call sites could each get wrong.
  private assertOwnership(permissions: OwnedObjectPermissions): void {
    if (
      this.expectedOwnership &&
      (permissions.ownerId !== this.expectedOwnership.ownerId ||
        permissions.groupId !== this.expectedOwnership.groupId)
    ) {
      throw new Error(
        `Refusing to grant Paperless permissions for org ${this.orgId} that don't match its own ` +
          `service user/group (got owner=${permissions.ownerId} group=${permissions.groupId}, ` +
          `expected owner=${this.expectedOwnership.ownerId} group=${this.expectedOwnership.groupId})`
      );
    }
  }

  // The only way to create a tenant-owned object — permissions required, validated against
  // this tenant before sending (isolation test #20).
  async createOwnedObject<T>(
    path: string,
    body: Record<string, unknown>,
    permissions: OwnedObjectPermissions
  ): Promise<T> {
    this.assertOwnership(permissions);

    const payload: PaperlessSetPermissions & Record<string, unknown> = {
      ...body,
      owner: permissions.ownerId,
      set_permissions: {
        view: { users: [], groups: [permissions.groupId] },
        change: { users: [], groups: [permissions.groupId] }
      }
    };

    return this.request<T>(path, { method: "POST", body: payload });
  }

  // post_document/ does not itself grant the tenant group view/change on the resulting
  // document (docs/spike-findings.md's isolation spike: "upload alone may not set group
  // perms") — callers must PATCH this onto every document created via postForm(), the same way
  // createOwnedObject() sets it inline for every JSON-created object. Skipping this is the
  // same class of P1 leak createOwnedObject() guards against.
  async setOwnedObjectPermissions(
    path: string,
    permissions: OwnedObjectPermissions
  ): Promise<void> {
    this.assertOwnership(permissions);

    const payload: PaperlessSetPermissions = {
      owner: permissions.ownerId,
      set_permissions: {
        view: { users: [], groups: [permissions.groupId] },
        change: { users: [], groups: [permissions.groupId] }
      }
    };

    await this.request<void>(path, { method: "PATCH", body: payload });
  }
}

const tenantClientCache = new Map<string, { client: PaperlessClient; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

// The only way to get a tenant Paperless client. Admin Supabase client, not RLS-scoped —
// tenant_paperless_config has no RLS policies (admin-only) and this runs from workers too.
export async function paperlessFor(orgId: string): Promise<PaperlessClient> {
  const cached = tenantClientCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const admin = createAdminClient();
  const { data: config, error } = await admin
    .from("tenant_paperless_config")
    .select("base_url, service_user_id, group_id, api_token_encrypted")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) throw error;
  if (!config) {
    throw new OrgNotProvisionedError(
      `No Paperless config for org ${orgId} — provisioning incomplete`
    );
  }

  const token = decryptPaperlessToken(
    decodePostgresBytea(config.api_token_encrypted as unknown as string)
  );
  const client = new PaperlessClient(
    orgId,
    { baseUrl: config.base_url, token },
    { ownerId: config.service_user_id, groupId: config.group_id }
  );

  tenantClientCache.set(orgId, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
}

let adminTokenCache: { token: string; expiresAt: number } | null = null;

async function getAdminToken(): Promise<string> {
  if (adminTokenCache && adminTokenCache.expiresAt > Date.now()) return adminTokenCache.token;

  const baseUrl = requireEnv("PAPERLESS_ADMIN_URL");
  const res = await fetch(`${baseUrl}/api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: requireEnv("PAPERLESS_ADMIN_USER"),
      password: requireEnv("PAPERLESS_ADMIN_PASSWORD")
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to obtain Paperless admin token: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { token: string };
  // Tokens don't expire on their own; re-fetch hourly anyway to pick up a rotated password.
  adminTokenCache = { token: data.token, expiresAt: Date.now() + 60 * 60 * 1000 };
  return adminTokenCache.token;
}

// Provisioning only, never tenant work — import restricted via eslint.config.mjs.
export async function paperlessAdminClient(): Promise<PaperlessClient> {
  const token = await getAdminToken();
  return new PaperlessClient(
    "__admin__",
    { baseUrl: requireEnv("PAPERLESS_ADMIN_URL"), token },
    null
  );
}

// Event-bridge webhook's tenant lookup — narrow on purpose so the admin-client import
// restriction stays meaningful (see src/app/api/internal/paperless/document-consumed).
export async function resolveTenantForPaperlessDocument(
  paperlessDocumentId: number
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("paperless_object_map")
    .select("organization_id")
    .eq("object_type", "document")
    .eq("paperless_id", paperlessDocumentId)
    .maybeSingle();

  if (error) throw error;
  return data?.organization_id ?? null;
}
