// CI guard: a migration adding a tenant-scoped table (has organization_id) must also add its
// leading index + RLS + policy in the same file (specs/12-agent-rules.md rule 12).
// Run: npx tsx scripts/check-rls-coverage.ts — wired into .github/workflows/ci.yml.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Pre-Dokumenti migrations, already reviewed — some tables are owner-polymorphic or use an
// indexing choice this regex can't see. Baseline for "new tables going forward," not a loophole.
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

  const tableRegex =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(sql)) !== null) {
    const [, tableName, body] = match;

    if (!/organization_id/i.test(body)) {
      continue; // not a tenant-scoped table — nothing required
    }

    const missing: string[] = [];

    // PK on organization_id is a leading index by construction — no separate create index.
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

    // RLS-enabled + zero policies is valid for admin-client-only tables, but only with an
    // explicit marker — otherwise it's more likely a mistake than a design choice.
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
