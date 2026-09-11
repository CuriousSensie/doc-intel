// Phase 0 spike helper — bootstrap superuser calls for throwaway tenants. Not product code.

const PAPERLESS_URL = process.env.PAPERLESS_URL ?? "http://localhost:8010";

// Bare codename, not app_label.codename (qualified form 400s). A fresh group has none of these
// by default — separate layer from per-object ACLs. Phase 1 provisioning must grant the same set.
const TENANT_MODEL_PERMISSIONS = [
  "tag",
  "document",
  "documenttype",
  "correspondent",
  "storagepath",
  "customfield",
  "customfieldinstance",
  "savedview",
  "savedviewfilterrule",
  "note",
  "paperlesstask",
  "workflow",
  "workflowtrigger",
  "workflowaction"
].flatMap((model) => ["add", "change", "delete", "view"].map((action) => `${action}_${model}`));

export type PaperlessSession = {
  token: string;
  username: string;
};

async function paperlessFetch(path: string, token: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    // FormData needs fetch to set its own multipart boundary — forcing JSON caused a real 415.
    ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(init.headers as Record<string, string> | undefined)
  };

  if (token) {
    headers.Authorization = `Token ${token}`;
  }

  const res = await fetch(`${PAPERLESS_URL}${path}`, { ...init, headers });
  return res;
}

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

// Group + user + token, same shape as the real provisioning job minus encryption at rest.
export async function bootstrapTenant(
  adminToken: string,
  label: string
): Promise<{ groupId: number; userId: number; session: PaperlessSession }> {
  const suffix = `spike_${label}_${Date.now()}`;

  // Django group-level permissions, distinct from Paperless's per-object set_permissions.
  const groupRes = await paperlessFetch("/api/groups/", adminToken, {
    method: "POST",
    body: JSON.stringify({ name: `tenant_${suffix}`, permissions: TENANT_MODEL_PERMISSIONS })
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
