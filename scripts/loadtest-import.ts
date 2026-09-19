import { randomUUID } from "node:crypto";
import { createWriteStream, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

import ExcelJS from "exceljs";
import yazl from "yazl";

import { importsConfig } from "@/config/imports";
import type { ServiceContext } from "@/lib/service-context";

type Args = {
  rows: number;
  execute: boolean;
  keep: boolean;
  timeoutMinutes: number;
};

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

const PDF_BYTES = Buffer.from(
  `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 42 >>
stream
BT /F1 24 Tf 20 100 Td (m9 import) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`,
  "ascii"
);

function loadDotEnv(): void {
  let content = "";
  try {
    content = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const getNumber = (flag: string, fallback: number) => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return fallback;
    const value = Number(argv[idx + 1]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number`);
    return Math.trunc(value);
  };

  return {
    rows: getNumber("--rows", 250),
    execute: argv.includes("--execute"),
    keep: argv.includes("--keep"),
    timeoutMinutes: getNumber("--timeout-minutes", 50)
  };
}

async function buildArchive(dir: string, rows: number): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Manifest");
  sheet.addRow(["filename"]);
  for (let i = 1; i <= rows; i++) {
    sheet.addRow([`documents/m9-${String(i).padStart(5, "0")}.pdf`]);
  }
  const manifest = Buffer.from(await workbook.xlsx.writeBuffer());

  const zipPath = join(dir, `phase3-m9-${rows}.zip`);
  const zip = new yazl.ZipFile();
  zip.addBuffer(manifest, "manifest.xlsx");
  for (let i = 1; i <= rows; i++) {
    zip.addBuffer(PDF_BYTES, `documents/m9-${String(i).padStart(5, "0")}.pdf`);
  }

  const out = createWriteStream(zipPath);
  zip.outputStream.pipe(out);
  zip.end();
  await once(out, "close");
  return zipPath;
}

async function createFixture(admin: AdminClient) {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `m9-${runId}@example.com`;
  const password = "TestPassword123!";
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (userError) throw userError;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: `Phase 3 M9 ${runId}`,
      slug: `phase3-m9-${runId}`,
      created_by: userData.user.id
    })
    .select("id")
    .single();
  if (orgError) throw orgError;

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: userData.user.id, role: "owner" });
  if (memberError) throw memberError;

  return { userId: userData.user.id, orgId: org.id };
}

async function removeStorageObjects(admin: AdminClient, paths: string[]) {
  for (let i = 0; i < paths.length; i += 1000) {
    const batch = paths.slice(i, i + 1000);
    if (batch.length > 0) await admin.storage.from(importsConfig.bucket).remove(batch);
  }
}

async function cleanup(admin: AdminClient, orgId: string, userId: string) {
  const { data: jobs } = await admin
    .from("import_jobs")
    .select("storage_key")
    .eq("organization_id", orgId);
  await removeStorageObjects(
    admin,
    (jobs ?? []).flatMap((job) => (job.storage_key ? [job.storage_key] : []))
  );

  const { data: uploads } = await admin
    .from("document_uploads")
    .select("storage_path")
    .eq("organization_id", orgId);
  for (let i = 0; i < (uploads ?? []).length; i += 1000) {
    const batch = (uploads ?? []).slice(i, i + 1000).map((upload) => upload.storage_path);
    if (batch.length > 0) await admin.storage.from("document-uploads").remove(batch);
  }

  await admin.from("organizations").delete().eq("id", orgId);
  await admin.auth.admin.deleteUser(userId);
}

async function pollUntilDone(
  admin: AdminClient,
  orgId: string,
  jobId: string,
  timeoutMinutes: number
) {
  const started = Date.now();
  const deadline = started + timeoutMinutes * 60_000;
  let lastProcessed = -1;

  while (Date.now() < deadline) {
    const { data: job, error } = await admin
      .from("import_jobs")
      .select("status,total_rows,processed_rows,succeeded_rows,failed_rows,skipped_rows")
      .eq("id", jobId)
      .eq("organization_id", orgId)
      .single();
    if (error) throw error;

    if (job.processed_rows !== lastProcessed) {
      lastProcessed = job.processed_rows;
      console.log(
        `progress ${job.processed_rows}/${job.total_rows} status=${job.status} ok=${job.succeeded_rows} failed=${job.failed_rows} skipped=${job.skipped_rows}`
      );
    }

    if (["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status)) {
      return { job, elapsedMs: Date.now() - started };
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Timed out waiting for import ${jobId}`);
}

async function main() {
  loadDotEnv();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { analyzeImportJob, startImportJob, updateImportMapping, validateImportJob } =
    await import("@/modules/imports/imports.service");

  const args = parseArgs();
  if (args.rows > importsConfig.maxRows) {
    throw new Error(`--rows cannot exceed importsConfig.maxRows (${importsConfig.maxRows})`);
  }

  const admin = createAdminClient();
  const tempDir = await mkdtemp(join(tmpdir(), "phase3-m9-"));
  let fixture: Awaited<ReturnType<typeof createFixture>> | null = null;

  try {
    fixture = await createFixture(admin);
    const ctx: ServiceContext = {
      db: admin,
      orgId: fixture.orgId,
      actorId: fixture.userId,
      correlationId: randomUUID()
    };

    console.log(`building ${args.rows}-document ZIP with XLSX manifest`);
    const zipPath = await buildArchive(tempDir, args.rows);
    const storageKey = `${fixture.orgId}/${randomUUID()}-phase3-m9-${args.rows}.zip`;
    const { error: uploadError } = await admin.storage
      .from(importsConfig.bucket)
      .upload(storageKey, readFileSync(zipPath), { contentType: "application/zip" });
    if (uploadError) throw uploadError;

    const { data: job, error: jobError } = await admin
      .from("import_jobs")
      .insert({
        organization_id: fixture.orgId,
        kind: "documents",
        created_by: fixture.userId,
        status: "draft",
        source_filename: `phase3-m9-${args.rows}.zip`,
        storage_key: storageKey
      })
      .select("id")
      .single();
    if (jobError) throw jobError;

    const analyzeStarted = Date.now();
    const analysis = await analyzeImportJob(ctx, job.id);
    console.log(`analyze ${analysis.rowCount} rows in ${Date.now() - analyzeStarted}ms`);

    await updateImportMapping(ctx, job.id, {
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [],
      fields: [],
      duplicateStrategy: "skip"
    });

    const validateStarted = Date.now();
    const summary = await validateImportJob(ctx, job.id);
    console.log(`validate in ${Date.now() - validateStarted}ms`, summary);

    if (args.execute) {
      const runStarted = Date.now();
      await startImportJob(ctx, job.id);
      const { job: finalJob, elapsedMs } = await pollUntilDone(
        admin,
        fixture.orgId,
        job.id,
        args.timeoutMinutes
      );
      console.log(`run in ${elapsedMs}ms`, finalJob);
      console.log(
        `total analyze+validate+run ${(Date.now() - runStarted + validateStarted - analyzeStarted) / 1000}s`
      );
    } else {
      console.log("skipped execution; pass --execute to enqueue the real chunked run");
    }

    if (args.keep) {
      console.log(`kept fixture org=${fixture.orgId} user=${fixture.userId} job=${job.id}`);
    } else {
      await cleanup(admin, fixture.orgId, fixture.userId);
      fixture = null;
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    if (fixture && !args.keep) await cleanup(admin, fixture.orgId, fixture.userId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
