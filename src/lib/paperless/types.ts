// Pinned to paperlessngx/paperless-ngx:3.1.3. Only shapes confirmed against a live instance —
// don't pre-guess fields (docs/spike-findings.md §1 found three wrong assumptions this way).

export type PaperlessListEnvelope<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

// results (paginated), lowercase status, related_document_ids as a list — all confirmed live.
export type PaperlessTask = {
  id: number;
  task_id: string;
  task_type: string;
  status: "success" | "failure" | "pending" | string;
  date_created: string;
  date_started: string | null;
  date_done: string | null;
  duration_seconds: number | null;
  related_document_ids: number[] | null;
  result?: string;
  owner: number | null;
};

// page_count/mime_type/deleted_at/versions confirmed live against the pinned instance
// (2026-09-12) — page_count and mime_type are direct fields; there is no byte_size field
// anywhere on this response (checked both the list and detail shapes), so that still has to
// come from document_uploads on the upload path only. checksum lives on the root entry of
// `versions`, not as a top-level field.
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
  versions: Array<{
    id: number;
    added: string;
    version_label: string | null;
    checksum: string;
    is_root: boolean;
  }>;
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
