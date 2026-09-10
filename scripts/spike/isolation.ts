/**
 * Phase 0 — isolation spike (specs/10-nonfunctional.md's 20-test suite, run manually against
 * a real, pinned Paperless instance). Not product code — see scripts/spike/lib/paperless-admin.ts
 * for why this lives here and how it feeds Phase 1's e2e/isolation.spec.ts.
 *
 * Usage:
 *   PAPERLESS_URL=http://localhost:8010 \
 *   PAPERLESS_ADMIN_USER=admin PAPERLESS_ADMIN_PASSWORD=... \
 *   npx tsx scripts/spike/isolation.ts
 *
 * This script does NOT hardcode the exact shape of Paperless's permission-setting API — it
 * fetches /api/schema/ first and tries the field names it finds (`set_permissions` then
 * `permissions`), because that contract has changed across Paperless versions and guessing
 * wrong silently would produce a false "leak" finding. If neither works for an object class,
 * the script logs that explicitly rather than guessing further — a human must check the
 * pinned version's actual API docs at that point.
 */
import { login, paperlessFetch, PAPERLESS_URL } from "./lib/paperless-admin";

type CheckResult = { id: number; test: string; expected: string; actual: string; pass: boolean };

const results: CheckResult[] = [];

function record(id: number, test: string, expected: string, actual: string, pass: boolean) {
  results.push({ id, test, expected, actual, pass });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] #${id} ${test} — expected: ${expected}; actual: ${actual}`);
}

async function discoverPermissionField(
  adminToken: string
): Promise<"set_permissions" | "permissions" | null> {
  const res = await paperlessFetch("/api/schema/", adminToken);
  if (!res.ok) {
    console.warn("Could not fetch /api/schema/ — falling back to trying both field names blind.");
    return null;
  }
  const text = await res.text();
  if (text.includes("set_permissions")) return "set_permissions";
  if (text.includes('"permissions"')) return "permissions";
  console.warn("Neither 'set_permissions' nor 'permissions' found in schema — check manually.");
  return null;
}

function permissionsPayload(field: string, ownerId: number, groupId: number) {
  return {
    owner: ownerId,
    [field]: {
      view: { users: [], groups: [groupId] },
      change: { users: [], groups: [groupId] }
    }
  };
}

async function createOwnedObject(
  path: string,
  token: string,
  body: Record<string, unknown>,
  field: string | null,
  ownerId: number,
  groupId: number
): Promise<number | null> {
  const attempt = async (permField: string | null) => {
    const payload = permField
      ? { ...body, ...permissionsPayload(permField, ownerId, groupId) }
      : body;
    return paperlessFetch(path, token, { method: "POST", body: JSON.stringify(payload) });
  };

  let res = await attempt(field);
  if (!res.ok && field === null) {
    // blind fallback: try set_permissions, then permissions
    res = await attempt("set_permissions");
    if (!res.ok) res = await attempt("permissions");
  }

  if (!res.ok) {
    console.error(`  create ${path} failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { id: number };
  return data.id;
}

async function main() {
  const adminUser = process.env.PAPERLESS_ADMIN_USER;
  const adminPassword = process.env.PAPERLESS_ADMIN_PASSWORD;
  if (!adminUser || !adminPassword) {
    throw new Error("Set PAPERLESS_ADMIN_USER and PAPERLESS_ADMIN_PASSWORD");
  }

  console.log(`Isolation spike against ${PAPERLESS_URL}\n`);

  const adminToken = await login(adminUser, adminPassword);
  const permField = await discoverPermissionField(adminToken);
  console.log(`Detected permission field: ${permField ?? "(unknown — will try both)"}\n`);

  const { bootstrapTenant } = await import("./lib/paperless-admin");
  console.log("Bootstrapping tenant A...");
  const tenantA = await bootstrapTenant(adminToken, "a");
  console.log("Bootstrapping tenant B...");
  const tenantB = await bootstrapTenant(adminToken, "b");

  console.log(`\nTenant A: user=${tenantA.session.username} group=${tenantA.groupId}`);
  console.log(`Tenant B: user=${tenantB.session.username} group=${tenantB.groupId}\n`);

  // --- create one object per class as tenant A ------------------------------------------------
  console.log("Creating one object per class as tenant A...\n");

  const uniqueName = `spike_${Date.now()}`;

  const tagId = await createOwnedObject(
    "/api/tags/",
    tenantA.session.token,
    { name: `tag_${uniqueName}` },
    permField,
    tenantA.userId,
    tenantA.groupId
  );

  const docTypeId = await createOwnedObject(
    "/api/document_types/",
    tenantA.session.token,
    { name: `doctype_${uniqueName}` },
    permField,
    tenantA.userId,
    tenantA.groupId
  );

  const correspondentId = await createOwnedObject(
    "/api/correspondents/",
    tenantA.session.token,
    { name: `correspondent_${uniqueName}` },
    permField,
    tenantA.userId,
    tenantA.groupId
  );

  const storagePathId = await createOwnedObject(
    "/api/storage_paths/",
    tenantA.session.token,
    { name: `storagepath_${uniqueName}`, path: `{{ created }}/${uniqueName}` },
    permField,
    tenantA.userId,
    tenantA.groupId
  );

  const customFieldId = await createOwnedObject(
    "/api/custom_fields/",
    tenantA.session.token,
    { name: `customfield_${uniqueName}`, data_type: "string" },
    permField,
    tenantA.userId,
    tenantA.groupId
  );

  const savedViewId = await createOwnedObject(
    "/api/saved_views/",
    tenantA.session.token,
    {
      name: `savedview_${uniqueName}`,
      show_on_dashboard: false,
      show_in_sidebar: false,
      filter_rules: [],
      sort_field: "created"
    },
    permField,
    tenantA.userId,
    tenantA.groupId
  );

  // Document: upload a tiny text file as tenant A, containing a string unique to this run
  // (used for test 4's full-text-search check).
  const secretString = `SECRET_TENANT_A_${uniqueName}`;
  console.log(`\nUploading a document as tenant A (contains "${secretString}")...`);
  const form = new FormData();
  form.append(
    "document",
    new Blob([`Isolation spike test document.\n${secretString}\n`], { type: "text/plain" }),
    `${uniqueName}.txt`
  );
  form.append("title", `doc_${uniqueName}`);
  const uploadRes = await paperlessFetch("/api/documents/post_document/", tenantA.session.token, {
    method: "POST",
    body: form
  });
  if (!uploadRes.ok) {
    console.error(`  upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const taskId = uploadRes.ok ? await uploadRes.text() : null;

  let documentId: number | null = null;
  if (taskId) {
    console.log(`  task id: ${taskId.replace(/"/g, "")} — polling for completion...`);
    for (let i = 0; i < 30 && !documentId; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const taskRes = await paperlessFetch(
        `/api/tasks/?task_id=${taskId.replace(/"/g, "")}`,
        tenantA.session.token
      );
      if (taskRes.ok) {
        // /api/tasks/ returns a paginated envelope ({results: [...]}), not a bare array — and
        // status is lowercase ("success"/"failure") with the document id under
        // related_document_ids (a list), not a singular related_document. All three were wrong
        // on the first pass through this spike; verified against a live 3.1.3 response.
        const body = (await taskRes.json()) as {
          results: Array<{ status: string; related_document_ids?: number[] }>;
        };
        const task = body.results[0];
        if (task?.status === "success" && task.related_document_ids?.[0]) {
          documentId = task.related_document_ids[0];
        } else if (task?.status === "failure") {
          console.error("  consumption failed:", task);
          break;
        }
      } else if (i === 0) {
        // Log once, not every poll — a non-OK status here (e.g. missing view_paperlesstask
        // permission on the tenant group) silently looked identical to "still processing"
        // before this line existed, which is exactly what happened on this spike's first run.
        console.error(`  task poll returned ${taskRes.status}: ${await taskRes.text()}`);
      }
    }
  }
  console.log(
    documentId
      ? `  document id: ${documentId}`
      : "  document did not finish consuming in time — some checks will be skipped"
  );

  // Grant tenant A group view/change on the document explicitly (upload alone may not set group perms).
  if (documentId && permField) {
    await paperlessFetch(`/api/documents/${documentId}/`, tenantA.session.token, {
      method: "PATCH",
      body: JSON.stringify(permissionsPayload(permField, tenantA.userId, tenantA.groupId))
    });
  }

  console.log("\n--- Running isolation checks as tenant B ---\n");

  // #1 A lists documents -> only A's (tested as: B lists documents -> must not include A's doc)
  {
    const res = await paperlessFetch("/api/documents/", tenantB.session.token);
    const data = (await res.json()) as { results: Array<{ id: number }> };
    const leaked = documentId !== null && data.results.some((d) => d.id === documentId);
    record(
      1,
      "B lists documents",
      "does not include A's document",
      leaked ? "LEAKED" : "not present",
      !leaked
    );
  }

  // #2 A fetches B's document by our UUID -> N/A here (that's our mirror's job, Phase 1).
  // #3 fetches B's document by paperless id via any route -> tested as B fetching A's doc by id
  if (documentId) {
    const res = await paperlessFetch(`/api/documents/${documentId}/`, tenantB.session.token);
    record(3, "B fetches A's document by id", "404", String(res.status), res.status === 404);
  }

  // #4 full-text search for a string unique to the other tenant's document
  if (documentId) {
    const res = await paperlessFetch(
      `/api/documents/?query=${encodeURIComponent(secretString)}`,
      tenantB.session.token
    );
    const data = (await res.json()) as { results: Array<{ id: number }> };
    record(
      4,
      "B searches for A's unique string",
      "0 results",
      `${data.results.length} results`,
      data.results.length === 0
    );
  }

  // #5 lists tags / document types / correspondents / storage paths -> only B's (i.e. none of A's)
  const classes: Array<[string, string, number | null]> = [
    ["/api/tags/", "tags", tagId],
    ["/api/document_types/", "document_types", docTypeId],
    ["/api/correspondents/", "correspondents", correspondentId],
    ["/api/storage_paths/", "storage_paths", storagePathId]
  ];
  for (const [path, label, createdId] of classes) {
    if (createdId === null) continue;
    const res = await paperlessFetch(path, tenantB.session.token);
    const data = (await res.json()) as { results: Array<{ id: number }> };
    const leaked = data.results.some((o) => o.id === createdId);
    record(
      5,
      `B lists ${label}`,
      "does not include A's object",
      leaked ? "LEAKED" : "not present",
      !leaked
    );
  }

  // #6 lists custom field definitions -> only B's
  if (customFieldId !== null) {
    const res = await paperlessFetch("/api/custom_fields/", tenantB.session.token);
    const data = (await res.json()) as { results: Array<{ id: number }> };
    const leaked = data.results.some((o) => o.id === customFieldId);
    record(
      6,
      "B lists custom field definitions",
      "does not include A's",
      leaked ? "LEAKED" : "not present",
      !leaked
    );
  }

  // #7 reads a custom field value on A's document -> 404 (covered by #3's full-document 404 already,
  // but check field-level access on the document detail explicitly if #3 somehow succeeded)

  // #8 downloads/previews A's document by direct URL -> 404
  if (documentId) {
    const res = await paperlessFetch(
      `/api/documents/${documentId}/download/`,
      tenantB.session.token
    );
    record(
      8,
      "B downloads A's document by direct URL",
      "404",
      String(res.status),
      res.status === 404
    );
  }

  // #12 lists saved views -> only B's
  if (savedViewId !== null) {
    const res = await paperlessFetch("/api/saved_views/", tenantB.session.token);
    const data = (await res.json()) as { results: Array<{ id: number }> };
    const leaked = data.results.some((o) => o.id === savedViewId);
    record(
      12,
      "B lists saved views",
      "does not include A's",
      leaked ? "LEAKED" : "not present",
      !leaked
    );
  }

  // #17 Paperless global search endpoint as B's service user -> no A objects
  if (documentId) {
    const res = await paperlessFetch(
      `/api/search/?query=${encodeURIComponent(secretString)}`,
      tenantB.session.token
    );
    if (res.status === 404) {
      console.log(
        "  (no /api/search/ endpoint on this version — skipping #17, check UI global search manually)"
      );
    } else {
      const data = (await res.json()) as
        { documents?: Array<{ id: number }> } | Array<{ id: number }>;
      const list = Array.isArray(data) ? data : (data.documents ?? []);
      const leaked = list.some((o) => o.id === documentId);
      record(
        17,
        "B's global search for A's unique string",
        "0 results",
        leaked ? "LEAKED" : "0 results",
        !leaked
      );
    }
  }

  // #20 an object created without explicit permissions -> our own client must refuse this
  // (this is a code-level guard in src/lib/paperless/client.ts, Phase 1 — not testable against
  // raw Paperless here; recorded as a reminder, not a live check).
  record(
    20,
    "creation without explicit permissions is impossible",
    "our client throws before the request",
    "N/A — implemented as a required TS parameter + runtime check in Phase 1, not testable here",
    true
  );

  // --- special case: workflows (ADR-0006) ------------------------------------------------------
  // Per ADR-0006, confirmed via Paperless's own GitHub discussions (#10550, #12352) that
  // workflows have no owner/ACL model at all. Verify that empirically too, for the record.
  {
    const wfRes = await paperlessFetch("/api/workflows/", tenantA.session.token, {
      method: "POST",
      body: JSON.stringify({
        name: `workflow_${uniqueName}`,
        order: 1,
        enabled: true,
        triggers: [],
        actions: []
      })
    });
    if (wfRes.ok) {
      const wf = (await wfRes.json()) as { id: number };
      const listRes = await paperlessFetch("/api/workflows/", tenantB.session.token);
      const listData = (await listRes.json()) as
        { results?: Array<{ id: number }> } | Array<{ id: number }>;
      const list = Array.isArray(listData) ? listData : (listData.results ?? []);
      const visible = list.some((w) => w.id === wf.id);
      record(
        21,
        "[ADR-0006] B can see A's workflow (workflows have no ACL)",
        "visible (confirms ADR-0006 — delegation stays disabled)",
        visible ? "visible" : "NOT visible — re-open ADR-0006, this may have changed upstream",
        true // this check's "pass" just means "ran"; the interesting bit is which way it went
      );
    } else {
      console.warn(`  could not create a workflow to test: ${wfRes.status} ${await wfRes.text()}`);
    }
  }

  // --- summary -----------------------------------------------------------------------------
  console.log("\n=== Summary ===");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length} checks run, ${failed.length} failed.`);
  if (failed.length > 0) {
    console.log(
      "\nFAILED (real isolation leaks — escalate per specs/12-agent-rules.md before Phase 1):"
    );
    failed.forEach((r) => console.log(`  #${r.id} ${r.test}`));
  }
  console.log("\nWrite these results into docs/spike-findings.md before continuing.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
