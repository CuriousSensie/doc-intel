// Pinned to paperlessngx/paperless-ngx:3.1.3. Only shapes confirmed against a live instance —
// don't pre-guess fields (docs/spike-findings.md §1 found three wrong assumptions this way).

export type PaperlessListEnvelope<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

// results (paginated), lowercase status, related_document_ids as a list — all confirmed live.
// Phase 3 M3 re-verified this shape live: the field is `result_data` (an object, e.g.
// `{ document_id: N }` on success — never confirmed for a real failure, so treated as
// `unknown`), not `result` as this type previously claimed — that was a real, latent bug
// (submit-upload-to-paperless.ts's failure message read `task.result`, always undefined).
// `status` also passes through an intermediate `"started"` value before success/failure.
// `owner` is the Paperless user id that submitted the task (the tenant service user for
// post_document/) — see docs/adr/0014-paperless-task-poller-isolation.md for why this matters:
// GET /api/tasks/ unfiltered returns every tenant's tasks (confirmed live, a real isolation
// gap), but GET /api/tasks/?task_id=<id> is correctly scoped to the caller's own tasks.
export type PaperlessTask = {
  id: number;
  task_id: string;
  task_type: string;
  status: "success" | "failure" | "started" | "pending" | string;
  date_created: string;
  date_started: string | null;
  date_done: string | null;
  duration_seconds: number | null;
  related_document_ids: number[] | null;
  result_data?: unknown;
  owner: number | null;
};

// Confirmed live against the pinned instance: a `select`-typed field's `extra_data.select_options`
// is `Array<{id: string, label: string}>` — `id` is a Paperless-generated random string, not
// something we choose, and a document's *value* for a select field must be one of these `id`s,
// never the label (Paperless validates this server-side, rejecting a label passed as a value).
export type PaperlessCustomFieldSelectOption = { id: string; label: string };

export type PaperlessCustomField = {
  id: number;
  name: string;
  data_type: string;
  extra_data: { select_options?: PaperlessCustomFieldSelectOption[]; default_currency?: string | null } | null;
  document_count?: number;
};

// page_count/mime_type/deleted_at/versions confirmed live against the pinned instance
// (2026-09-12) — page_count and mime_type are direct fields; there is no byte_size field
// anywhere on this response (checked both the list and detail shapes), so that still has to
// come from document_uploads on the upload path only. checksum lives on the root entry of
// `versions`, not as a top-level field. custom_fields confirmed live (2026-09-13): a flat
// `{field, value}[]` array embedded directly on the document object, no separate endpoint.
export type PaperlessDocument = {
  id: number;
  title: string;
  content: string;
  correspondent: number | null;
  document_type: number | null;
  storage_path: number | null;
  tags: number[];
  created: string;
  added: string;
  modified: string;
  deleted_at: string | null;
  owner: number | null;
  page_count: number | null;
  mime_type: string | null;
  // Confirmed live (2026-09-16): present on both list and detail shapes.
  original_file_name: string;
  custom_fields: Array<{ field: number; value: unknown }>;
  versions: Array<{
    id: number;
    added: string;
    version_label: string | null;
    checksum: string;
    is_root: boolean;
  }>;
};

// Confirmed live (2026-09-13) against GET /api/documents/:id/history/ — not paginated on this
// version (a plain array, no PaperlessListEnvelope). `actor` is null for system-initiated
// changes (e.g. the initial post_document/ create), populated for a PATCH made under a real
// tenant service-user token.
export type PaperlessDocumentHistoryEntry = {
  id: number;
  timestamp: string;
  action: "create" | "update" | "delete" | string;
  changes: Record<string, unknown>;
  actor: { id: number; username: string } | null;
};

// Per-object owner/ACL payload. Field is `set_permissions` on this pinned version, not
// `permissions` — has changed across Paperless versions before, client.ts probes defensively.
export type PaperlessSetPermissions = {
  owner: number;
  set_permissions: {
    view: { users: number[]; groups: number[] };
    change: { users: number[]; groups: number[] };
  };
};

// Bare codename, not app_label.codename (qualified form 400s). A fresh group has none of
// these by default — see docs/spike-findings.md §1.
export const TENANT_MODEL_PERMISSIONS = [
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
