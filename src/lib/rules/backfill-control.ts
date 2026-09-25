import { getRedisClient } from "@/lib/redis";

// A Redis-keyed pause/resume/cancel flag (pause/resume/cancel must take effect for a chunk
// already mid-flight in the queue, not just future ones) — kept as its own small module since
// rule-backfill control has no other shared code worth forcing an abstraction over.
export type RuleBackfillControlState = "running" | "paused" | "cancelled";

const TTL_SECONDS = 7 * 24 * 60 * 60;

function controlKey(ruleBackfillId: string): string {
  return `rule_backfill:${ruleBackfillId}:control`;
}

export async function setRuleBackfillControl(ruleBackfillId: string, state: RuleBackfillControlState): Promise<void> {
  await getRedisClient().set(controlKey(ruleBackfillId), state, "EX", TTL_SECONDS);
}

export async function getRuleBackfillControl(ruleBackfillId: string): Promise<RuleBackfillControlState> {
  const value = await getRedisClient().get(controlKey(ruleBackfillId));
  return (value as RuleBackfillControlState | null) ?? "running";
}

export async function clearRuleBackfillControl(ruleBackfillId: string): Promise<void> {
  await getRedisClient().del(controlKey(ruleBackfillId));
}
