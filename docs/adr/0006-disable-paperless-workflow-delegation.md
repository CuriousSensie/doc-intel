# ADR-0006: Disable Paperless workflow delegation for the MVP

## Context

`specs/07-rules-engine.md` specifies a delegation model: where a tenant's rule's actions map
entirely onto Paperless's native workflow actions (set document type, tags, correspondent,
custom fields, storage path, email), the implementation should create a Paperless workflow via
the API instead of evaluating the rule locally — since Paperless already does this natively and
it's presented as "free" automation.

This build runs a **shared** Paperless instance across all tenants (D2), with isolation enforced
by Paperless's own per-object ACLs. That model only works if every object class Paperless
exposes actually supports per-object ownership/permissions. During plan review, this was
checked directly against Paperless-ngx's own issue tracker: GitHub discussions
[#10550](https://github.com/paperless-ngx/paperless-ngx/discussions/10550) ("Granular
Permissions and Ownership for Workflows") and
[#12352](https://github.com/paperless-ngx/paperless-ngx/discussions/12352) ("User-Based Scoping
for Workflows and Automation") confirm that **workflows are currently global objects** — any
user with `Workflow[view]`/`Workflow[change]` rights sees and can edit *every* workflow on the
instance, and both feature requests for per-tenant workflow ownership remain open/unresolved as
of this session. This is a materially different and more serious problem than the isolation
spike's per-object-class visibility test (`specs/10-nonfunctional.md` test 5 style) — a workflow
isn't just *visible* across tenants, it *executes* against every document that matches its
trigger condition, regardless of which tenant's service user created it or which tenant owns the
matching document.

## Decision

Rule delegation to Paperless workflows is **not implemented** for the MVP. Every rule, regardless
of whether its actions could theoretically map onto native Paperless workflow actions, is
evaluated locally in our own rules engine (`specs/07-rules-engine.md`'s "our engine" path,
always). The `rules.delegate_to_paperless` column and `src/lib/paperless/workflows.ts` remain in
the schema/codebase for forward compatibility, but the evaluator never sets or honors
`delegate_to_paperless = true` while the deployment is a shared Paperless instance.

## Alternatives considered

- **Implement delegation as specced.** Rejected outright: on a shared instance, a delegated
  workflow would fire on every tenant's matching documents, not just the owning tenant's — a
  direct, structural cross-tenant data leak (tenant A's workflow-driven tag/field/correspondent
  changes would apply to tenant B's documents too). This isn't a bug to fix later; it's
  incompatible with D2's whole isolation model as currently designed.
- **Implement delegation only after verifying per-tenant isolation empirically in Phase 0.**
  Rejected as the primary plan — the answer is already knowable from Paperless's own tracked,
  open feature requests without needing to build and then discover the leak in the isolation
  suite. Phase 0's spike still documents this finding formally (rather than only running the
  20-test isolation checklist) so it's traceable to a specific, dated piece of evidence.
- **Give each tenant a dedicated Paperless instance so workflows are safely tenant-scoped.**
  Rejected for the MVP: D2 explicitly defers dedicated-per-tenant instances to a later paid tier
  to avoid the provisioning-fleet operational load on a solo developer before customer #1. This
  remains the eventual path for delegation, not a rejected option — see Consequences.

## Consequences

- Every rule's actions run through our local evaluator (`src/modules/rules/rules.service.ts`),
  even the subset that's purely Paperless-native. Slightly more engine complexity now (no
  "simple" delegated path to lean on), but one execution path instead of two — which also avoids
  the double-execution risk `specs/07-rules-engine.md` itself warns against ("never implement
  both paths for the same rule").
- If a tenant later moves to a dedicated Paperless instance (D2's existing path via
  `tenant_paperless_config.base_url`), workflow delegation becomes safe again for that tenant
  specifically, since workflows would no longer be shared across tenants. Revisit this ADR (as a
  superseding ADR, not an edit) if/when that tier is built, or if Paperless upstream ships
  workflow ownership/ACLs (tracked by the two discussions linked above).
- No product-facing behavior change from the tenant's perspective — `specs/07-rules-engine.md`'s
  rule DSL, conditions, actions, dry-run trace, and backfill/undo behavior are all delivered
  identically; only the internal delegation optimization is withheld.
