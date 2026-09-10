/**
 * Phase 0 spike helper — talks to a real Paperless instance as the bootstrap superuser to set
 * up two throwaway tenants for the isolation spike (specs/10-nonfunctional.md's 20-test
 * suite). Not product code: excluded from the Next.js build, lives only under scripts/spike/.
 *
 * These same check functions are written so they can be lifted almost verbatim into
 * e2e/isolation.spec.ts in Phase 1 — see docs/IMPLEMENTATION_PLAN.md.
 */

const PAPERLESS_URL = process.env.PAPERLESS_URL ?? "http://localhost:8010";

export type PaperlessSession = {
  token: string;
  username: string;
};

async function paperlessFetch(path: string, token: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined)
  };

  if (token) {
    headers.Authorization = `Token ${token}`;
  }

  const res = await fetch(`${PAPERLESS_URL}${path}`, { ...init, headers });
  return res;
}

/** Obtains a token for an existing user via Paperless's /api/token/ endpoint. */
export async function login(username: string, password: string): Promise<string> {
  const res = await paperlessFetch("/api/token/", null, {
    method: "POST",
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    throw new Error(`login failed for ${username}: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { token: string };
  return data.token;
}

/**
 * Bootstraps one throwaway tenant: a group, a user in it, and that user's API token — the
 * same shape as the real provisioning job (worker/jobs/provision-tenant.ts, Phase 1) will
 * create, minus the encryption-at-rest step this spike doesn't need.
 */
export async function bootstrapTenant(
  adminToken: string,
  label: string
): Promise<{ groupId: number; userId: number; session: PaperlessSession }> {
  const suffix = `spike_${label}_${Date.now()}`;

  const groupRes = await paperlessFetch("/api/groups/", adminToken, {
    method: "POST",
    body: JSON.stringify({ name: `tenant_${suffix}` })
  });
  if (!groupRes.ok) {
    throw new Error(`create group failed: ${groupRes.status} ${await groupRes.text()}`);
  }
  const group = (await groupRes.json()) as { id: number };

  const password = `Sp1ke!${Math.random().toString(36).slice(2)}`;
  const userRes = await paperlessFetch("/api/users/", adminToken, {
    method: "POST",
    body: JSON.stringify({
      username: `svc_${suffix}`,
      password,
      is_staff: false,
      is_superuser: false,
      groups: [group.id]
    })
  });
  if (!userRes.ok) {
    throw new Error(`create user failed: ${userRes.status} ${await userRes.text()}`);
  }
  const user = (await userRes.json()) as { id: number; username: string };

  const token = await login(user.username, password);

  return {
    groupId: group.id,
    userId: user.id,
    session: { token, username: user.username }
  };
}

export { paperlessFetch, PAPERLESS_URL };
