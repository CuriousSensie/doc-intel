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
  owner: number | null;
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
