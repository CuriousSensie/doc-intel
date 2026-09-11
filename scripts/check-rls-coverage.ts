/**
 * CI guard for specs/12-agent-rules.md rule 12: "Never write a migration adding a
 * tenant-scoped table without its organization_id index and RLS policy in the same
 * migration." (organization_id, not org_id — see docs/adr/0004.)
 *
 * Static, regex-based, deliberately simple: for every `create table public.<name>` in a
 * migration file whose body references `organization_id`, that SAME file must also contain
 * `alter table public.<name> enable row level security` and at least one
 * `create policy ... on public.<name>`. This mirrors the exact pattern already used in
 * supabase/migrations/20260813180000_initial_schema.sql — this script doesn't invent a new
 * convention, it enforces the existing one.
 *
 * Run: npx tsx scripts/check-rls-coverage.ts
 * Wired into .github/workflows/ci.yml.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * The boilerplate's own pre-Pomočnik migrations, reviewed and accepted before this check
 * existed. Several of their tables are owner-polymorphic (`organization_id` is nullable —
 * `stripe_customers`, `subscriptions`, `credit_transactions`, `usage_counters` — see
 * docs/DATABASE.md's "Owner-polymorphic billing" note) or use a documented indexing choice
 * this check's simple heuristic can't see (`organization_invitations`). specs/12-agent-rules.md's
 * rule is about NEW tenant-scoped tables going forward, not a retroactive audit of already-
 * shipped schema — this baseline is what makes that distinction, not a loophole for new work.
 */
const EXEMPT_MIGRATIONS = new Set([
  "20260813180000_initial_schema.sql",
  "20260820120000_organizations_functions.sql",
  "20260820121500_organizations_delete_policy.sql",
  "20260821130000_billing_functions.sql",
  "20260822090000_files_storage.sql",
  "20260823090000_admin.sql"
]);

type Violation = { file: string; table: string; missing: string[] };

function checkFile(fileName: string, sql: string): Violation[] {
  const violations: Violation[] = [];

  // Find every `create table public.<name> ( ... )` block (case-insensitive, tolerant of
  // "create table if not exists").
  const tableRegex =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(sql)) !== null) {
    const [, tableName, body] = match;

    if (!/organization_id/i.test(body)) {
      continue; // not a tenant-scoped table — nothing required
    }

    const missing: string[] = [];

    // organization_id as the primary key (e.g. a 1:1 config table keyed by tenant) is a
    // leading index by construction — a separate `create index` isn't needed or expected.
    const organizationIdIsPrimaryKey = /organization_id\s+uuid\s+primary\s+key/i.test(body);

    const hasIndex =
      organizationIdIsPrimaryKey ||
      new RegExp(
        `create\\s+index[^;]*on\\s+public\\.${tableName}\\s*\\(\\s*organization_id`,
        "i"
      ).test(sql) ||
      // a leading composite index (organization_id, ...) also counts
      new RegExp(
        `create\\s+index[^;]*on\\s+public\\.${tableName}\\s*\\(\\s*organization_id\\s*,`,
        "i"
      ).test(sql);
    if (!hasIndex) missing.push("leading organization_id index");

    const hasRlsEnabled = new RegExp(
      `alter\\s+table\\s+public\\.${tableName}\\s+enable\\s+row\\s+level\\s+security`,
      "i"
    ).test(sql);
    if (!hasRlsEnabled) missing.push("`enable row level security`");

    // A table can legitimately have RLS enabled and NO policies at all — the existing
    // boilerplate convention for admin-client-only tables (stripe_customers, subscriptions,
    // webhook_events — docs/DATABASE.md). Require an explicit, per-table marker comment for
    // this rather than silently accepting "no policy" as ambiguous — a table with neither a
    // policy nor this marker is far more likely a mistake than an intentional design.
    const hasPolicy = new RegExp(`create\\s+policy[^;]*on\\s+public\\.${tableName}\\b`, "i").test(
      sql
    );
    const hasNoPolicyMarker = new RegExp(
      `--\\s*rls-coverage:\\s*admin-only[^\\n]*\\n(?:[^\\n]*\\n){0,2}[^\\n]*public\\.${tableName}\\b`,
      "i"
    ).test(sql);
    if (!hasPolicy && !hasNoPolicyMarker) {
      missing.push(
        "at least one `create policy ... on` this table (or a `-- rls-coverage: admin-only " +
          "(no policies)` marker directly above the `enable row level security` line, for a " +
          "deliberately admin-client-only table)"
      );
    }

    if (missing.length > 0) {
      violations.push({ file: fileName, table: tableName, missing });
    }
  }

  return violations;
}

function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const allViolations: Violation[] = [];

  for (const file of files) {
    if (EXEMPT_MIGRATIONS.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    allViolations.push(...checkFile(file, sql));
  }

  if (allViolations.length > 0) {
    console.error("RLS coverage check failed:\n");
    for (const v of allViolations) {
      console.error(`  ${v.file}: table "${v.table}" is missing: ${v.missing.join(", ")}`);
    }
    console.error(
      "\nEvery tenant-scoped table (has an organization_id column) needs a leading index on " +
        "organization_id, RLS enabled, and at least one policy — all in the same migration " +
        "file. See supabase/migrations/20260813180000_initial_schema.sql for the pattern."
    );
    process.exit(1);
  }

  console.log(
    `RLS coverage check passed — ${files.length} migration file(s) checked, no violations.`
  );
}

main();
