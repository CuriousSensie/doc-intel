// specs/07-rules-engine.md: cascade depth cap, per-document evaluation time budget, regex
// subject length cap (the length half of the regex-DoS defense — re2 itself is the timeout half,
// see src/lib/safe-regex.ts), and backfill chunking.
export const rulesConfig = {
  maxCascadeDepth: 3,
  evaluationTimeoutMs: 5000,
  regexSubjectMaxLength: 20_000,
  backfillChunkSize: 50,
  defaultBackfillConcurrencyPerOrganization: 4
} as const;
