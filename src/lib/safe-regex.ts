import RE2 from "re2";

import { rulesConfig } from "@/config/rules";

// specs/07-rules-engine.md: the `regex` condition operator must not be a catastrophic-
// backtracking DoS vector against a shared worker (a pathological pattern run against a 44-page
// OCR text is real, not hypothetical). RE2 is linear-time by construction (no backtracking
// engine at all), so this needs no separate timeout — an unsafe pattern simply cannot exist for
// it. A pattern RE2 can't compile (it doesn't support backreferences/lookaround) is treated as a
// non-match rather than thrown, since a rule author has no way to know which regex features RE2
// excludes and a rule that never matches is a debuggable, visible-in-the-trace failure mode, not
// a job-crashing one.
export function safeRegexTest(pattern: string, subject: string): boolean {
  const truncated = subject.slice(0, rulesConfig.regexSubjectMaxLength);
  try {
    const re = new RE2(pattern);
    return re.test(truncated);
  } catch {
    return false;
  }
}
