import type { ServiceContext } from "@/lib/service-context";

import type { RuleAction } from "./rules.schemas";

export type DelegationResult = { delegated: boolean; paperlessWorkflowId: number | null };

// docs/adr/0006-disable-paperless-workflow-delegation.md (locked): specs/07-rules-engine.md
// specs a delegation path where an all-Paperless-native rule becomes a real Paperless workflow
// instead of running through our local evaluator. Verified live against the pinned instance's
// own OpenAPI schema this session (GET /api/schema/) — Workflow/WorkflowTrigger have no owner or
// per-tenant scoping field at all; a workflow fires on every document matching its trigger
// instance-wide, regardless of which tenant's service user created it or owns the matching
// document. On the shared-instance architecture (D2), that's a structural cross-tenant leak, not
// an edge case — confirmed independently this session, matching the ADR's own finding (Paperless
// discussions #10550/#12352, still open). Delegation therefore stays permanently off while the
// deployment is a shared instance: this function never sets delegated: true. Every rule runs
// through rules.evaluator.ts/rules.dispatcher.ts locally, unconditionally, matching the ADR's
// "one execution path instead of two" consequence.
//
// The `actions` parameter is unused on purpose — kept in the signature so a future
// dedicated-per-tenant-instance build (D2's own escape hatch) can reintroduce the real decision
// procedure here without changing every call site.
export async function evaluateForDelegation(
  _ctx: ServiceContext,
  _actions: RuleAction[],
  _existingWorkflowId?: number | null
): Promise<DelegationResult> {
  return { delegated: false, paperlessWorkflowId: null };
}
