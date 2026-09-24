# ADR-0017: Per-document visibility and sharing inside an organization

## Context

`specs/02-data-model.md` and `specs/05-level-1-structure.md` treat every document in a tenant as
visible to every member of that tenant. Level 1 product testing showed this is wrong for the
target customers: a member's uploaded contracts or HR paperwork should not be readable by every
colleague by default.

Paperless cannot enforce this. Every object in a tenant is owned by one shared per-tenant service
user and group (`src/lib/paperless/client.ts`, D2), so its ACLs only distinguish tenant from
tenant, never member from member. The enforcement point therefore has to be our own database.

## Decision

- A document is visible to its **creator** (`documents.created_by`) and to the organization's
  **owner**. Nobody else, unless it is shared.
- The creator or owner can **share** a document with a specific member or with **everyone** in the
  organization, at `view` or `edit` level. Read-only members can never edit, regardless of share.
- Enforcement is one RLS policy, `documents_select_member`, backed by `SECURITY DEFINER` helpers
  (`can_manage_document`, `can_edit_document`, `is_document_shared_with_me`,
  `filter_document_ids`, `get_document_permissions`). Every document read/write/bulk path in
  `documents.service.ts` resolves its authorizing read through the RLS-scoped client before using
  the admin client for the privileged Paperless write, so the policy is the whole enforcement
  surface.
- Writes go through `share_document()` / `unshare_document()`, which write their `audit_logs` row
  in the same transaction ([ADR-0008](0008-transactional-audit-writes.md)). `document_shares` has no
  insert/update/delete policies.
- `preserve_document_creator()` (trigger) stops `created_by` being reassigned by a later sync, so
  ownership cannot be taken over by re-ingestion.
- Entities, connections, tags, correspondents, document types, attributes, rules and saved views
  stay fully **org-shared**: they are cross-referenced reference data, not personal documents.

## Alternatives considered

- **Org-wide visibility (the spec's model).** Simplest, but fails the confidentiality expectation
  above. Rejected after product testing.
- **Folder/collection-based ACLs.** More flexible, but needs a new object model and UI; per-document
  sharing covers the observed need at far lower cost. Revisit if customers ask for it.
- **Enforce in Paperless with per-user service users.** Multiplies Paperless users/tokens per tenant
  and still cannot express "owner sees all"; also deepens coupling to Paperless's permission model.

## Consequences

- Anything that reads `documents` through the RLS-scoped client (lists, search, stats, detail) is
  creator/owner/share scoped automatically. Paths that use the admin client (worker jobs such as rule
  backfill, bulk actions, exports) must keep resolving their authorizing read through the scoped
  client first; verify this for each new admin-client path.
- Entity and connection pages can reference documents a member cannot open. Confirm the UI degrades
  cleanly there (tracked in `docs/RELEASE_PLAN.md` §Open verification items).
- A change to `documents_select_member` is a security change: it needs the isolation suite
  (`e2e/isolation*.spec.ts`) plus a same-tenant two-member check before merge.
- Deviates from the spec; recorded here and in `docs/SPEC_TRACEABILITY.md`.

## Amendment (2026-09-24) — admin gets owner-equivalent document access

Post-launch feedback (organizations/team revamp, see
[ADR-0018](0018-one-organization-per-account.md)) established that "admin" is meant to be full
management short of ownership. This ADR's original `array['owner']` checks made an admin unable
to see, manage, or share a document they didn't create — the same gap the original decision
above was written to close for ordinary members, just left open for admins.

`20260929000000_admin_document_management_parity.sql` extends `documents_select_member`,
`document_uploads_select_member`, `can_manage_document()`, `can_edit_document()`, and
`get_document_permissions()` from `array['owner']` to `array['owner', 'admin']`. Owner-exclusive
actions — transfer ownership, delete organization, block/remove members — are untouched; those
still check `array['owner']` alone. The same migration also closed a related gap:
`has_organization_write_access()` ran its own raw query instead of going through
`is_organization_member()`/`has_organization_role()`, so a blocked member (ADR-0018) kept write
access to documents after being blocked.
