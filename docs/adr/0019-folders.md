# ADR-0019: App-owned folder hierarchy for documents

## Context

`specs/00-overview.md` lists "a physical folder hierarchy as the primary data model" as an
explicit non-goal, and [ADR-0017](0017-per-document-visibility-and-sharing.md) evaluated and
declined "folder/collection-based ACLs" as an alternative to per-document sharing, noting it
should be revisited "if customers ask for it." Two concrete needs now make both calls wrong:

1. Bulk folder upload must preserve a client-side directory structure server-side. Per-document
   sharing has no notion of "this batch of files is one organizational unit" — expressing a
   directory tree through individual document shares doesn't scale and loses the structure itself.
2. Folder-scoped access control was explicitly requested: a member needs access to several
   non-contiguous folders, cascading to their subfolders and documents, without the owner/admin
   re-sharing every document individually every time a new one lands in a granted folder.

A future desktop connector (out of scope here) that watches a local folder and mirrors it needs a
stable, addressable folder identity to sync against — the data model must not preclude that later.

Paperless cannot help: its own `storage_path` object is a flat, single-level path-template string,
not a real tree, and (per D2 and ADR-0017) every Paperless object is owned by one shared per-tenant
service user/group, so Paperless ACLs only ever distinguish tenant from tenant, never member from
member within one org.

## Decision

- Folders are a new, fully **app-owned** hierarchy: a `folders` table in our own Supabase Postgres
  database, not Paperless `storage_paths`. Paperless remains unaware of folder structure — it
  stays purely the OCR/storage/search engine underneath.
- Adjacency list (`parent_folder_id`) plus a materialized `path`/`path_ids`/`depth` on each row,
  recomputed for the whole affected subtree inside the same transaction on every move/rename —
  never computed lazily. `documents.folder_id` is a nullable FK; `null` ("unfiled") is a permanent,
  supported state, not a migration artifact.
- Folder access control mirrors the `document_shares` pattern from ADR-0017 structurally: a
  `folder_access` table (`folder_id`, `granted_to`, `permission`), written only through
  `SECURITY DEFINER` RPCs with an `audit_logs` row in the same transaction
  ([ADR-0008](0008-transactional-audit-writes.md)), no direct insert/update/delete policy. Access
  cascades: a grant on a folder also grants its descendant folders and their documents, resolved
  by walking each folder's `path_ids` (ancestor chain) rather than a separate closure table.
  Owner/admin bypass all folder access, matching the `array['owner','admin']` parity
  [ADR-0017's amendment](0017-per-document-visibility-and-sharing.md) established for documents.
- Auto-filing (`specs/07-rules-engine.md`'s "folders have a matching pattern, like tags/document
  types" requirement) extends the **existing app-level rules engine** rather than inventing a
  second matching system: a folder's own `match_conditions` column reuses the rules engine's
  `ConditionNode`/`conditionNodeSchema` verbatim and is evaluated on every `document.ingested` fire
  via the same `evaluateConditions()` used for authored rules. A new `move_to_folder` rule action
  is also added for hand-authored rules that file documents into a specific folder.

## Alternatives considered

- **Paperless `storage_path`.** Declined: flat namespace (effectively one level, a templated path
  string, not a real tree) with no per-member visibility control — the same tenant-vs-tenant-only
  ACL gap ADR-0017 already documented for tags/document types. Building an access-control concept
  on top of it would also cross D1 ("Paperless is the document engine... we do not reimplement
  [its responsibilities], but we also don't ask it to be more than that").
- **Tag-based pseudo-folders** (e.g. a `folder:Invoices/2025` tag convention). Declined: tags are
  flat and multi-valued by design, so a document could carry two "folder" tags at once, breaking
  "exactly one folder"; move/rename would become an error-prone multi-tag rewrite instead of a
  single FK update; and tags stay org-wide visible (ADR-0017), inheriting the same access gap.
- **Extend `document_shares` with a `folder_id` column.** Declined: sharing is deliberately
  per-document (ADR-0017's whole point was narrowing from org-wide to creator+shares); overloading
  it with cascading folder-level grants would mean two different permission-resolution algorithms
  in one table and one policy.
- **`ltree` extension for the materialized path.** Declined for v1: no other migration in this repo
  uses a non-default Postgres extension; an ancestor-id array plus adjacency list covers the
  descendant-query need without the dependency. Revisit only if move/descendant-query performance
  becomes a measured problem.

## Consequences

- `documents_select_member` (ADR-0017) gains a folder-cascading branch
  (`can_access_document_via_folder`) alongside creator/owner-admin/share — every document read path
  that resolves through the RLS-scoped client picks this up automatically, same as every prior
  ADR-0017 change.
- `move_to_folder` is the first rules-engine action that can affect document *visibility*, not just
  metadata — every other action (`connect_entity`, `set_custom_field`, etc.) is visibility-neutral.
- The bulk-folder-upload UI and the future desktop connector both depend on folders existing as
  stable, addressable objects with a `path` before either can be built; this ADR unlocks them
  without being scope for either itself.
- Folder name uniqueness within a parent is case-sensitive for v1 (no `lower(name)` normalization) —
  flagged as an open question if Slovenian users expect case-insensitive matching in practice.
