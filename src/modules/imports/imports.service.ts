import { randomUUID } from "node:crypto";

import { importsConfig } from "@/config/imports";
import {
  AuthorizationError,
  NotFoundError,
  UnprocessableError,
  ValidationError
} from "@/lib/errors";
import { logEvent } from "@/lib/events";
import {
  analyzeDelimitedFile,
  analyzeXlsxFile,
  detectImportFileFormat,
  extractZipEntryToTempFile,
  listZipEntries,
  streamDelimitedRows,
  streamXlsxRows,
  type ColumnPreview,
  type ZipEntryInfo
} from "@/lib/import/parse";
import { ImportRowError, type ImportErrorCode } from "@/lib/import/errors";
import type { ServiceContext } from "@/lib/service-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadStorageObjectToTempFile } from "@/lib/supabase/storage-stream";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { setImportControl } from "@/lib/import/control";
import type { Database, Json } from "@/types/database";

import {
  analysisOptionsSchema,
  type AnalysisOptions,
  mappingSchemaForKind,
  type DocumentImportMapping,
  type EntityImportMapping,
  type ImportKind,
  type ImportMapping,
  type MetadataOnlyImportMapping
} from "./imports.schemas";
import {
  resolveDocumentRowPlans,
  resolveEntityRowPlans,
  type RawImportRow
} from "./imports.matching";
import { openJobArchive } from "./imports.archive";

export type ImportJob = Database["public"]["Tables"]["import_jobs"]["Row"];
export type ImportRow = Database["public"]["Tables"]["import_rows"]["Row"];
export type ImportMappingRecord = Database["public"]["Tables"]["import_mappings"]["Row"];

type AdminDb = ReturnType<typeof createAdminClient>;

// import_jobs has no RLS update policy at all (only select-for-member, insert-of-a-draft-only)
// — the same shape as `documents` (see documents.service.ts's comment on updateDocument()).
// Every mutation past the initial draft insert goes through the admin client, gated by this
// explicit role check instead of RLS.
async function assertOrgWriteAccess(ctx: ServiceContext): Promise<void> {
  if (!ctx.actorId) throw new AuthorizationError("Authentication required");
  const { data: membership, error } = await ctx.db
    .from("organization_members")
    .select("role")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.actorId)
    .maybeSingle();
  if (error) throw error;
  if (!membership || membership.role === "read-only") {
    throw new AuthorizationError("You do not have write access to this organization");
  }
}

async function fetchImportJob(db: AdminDb, orgId: string, id: string): Promise<ImportJob> {
  const { data, error } = await db
    .from("import_jobs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Import job not found");
  return data;
}

function assertStatus(job: ImportJob, allowed: ImportJob["status"][]): void {
  if (!allowed.includes(job.status)) {
    throw new UnprocessableError(
      `Import job is "${job.status}" — this action requires one of: ${allowed.join(", ")}`
    );
  }
}

// -------------------------------------------------------------------------------------------
// Create + upload
// -------------------------------------------------------------------------------------------

export async function createImportJob(
  ctx: ServiceContext,
  input: { kind: ImportKind; filename: string; size: number; fromMappingId?: string }
): Promise<{ importJobId: string; signedUrl: string; token: string; path: string }> {
  if (input.size <= 0 || input.size > importsConfig.maxSizeBytes) {
    throw new ValidationError(
      `File size must be between 1 byte and ${importsConfig.maxSizeBytes} bytes`
    );
  }
  detectImportFileFormat(input.filename); // throws PARSE_ERROR on .xls / unsupported ext

  let mapping: Json = {};
  if (input.fromMappingId) {
    const { data: saved, error } = await ctx.db
      .from("import_mappings")
      .select("kind, mapping")
      .eq("id", input.fromMappingId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (error) throw error;
    if (!saved) throw new NotFoundError("Saved mapping not found");
    if (saved.kind !== input.kind) {
      throw new ValidationError(`Saved mapping is for "${saved.kind}", not "${input.kind}"`);
    }
    mapping = saved.mapping;
  }

  const path = `${ctx.orgId}/${randomUUID()}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  // RLS-scoped insert (import_jobs_insert_member requires status='draft' + zero counters) —
  // same division of labor as createUploadIntent(): the caller's own client does the
  // write-gated insert, the admin client only signs the upload URL.
  const { data: job, error: insertError } = await ctx.db
    .from("import_jobs")
    .insert({
      organization_id: ctx.orgId,
      kind: input.kind,
      source_filename: input.filename,
      storage_key: path,
      mapping,
      created_by: ctx.actorId
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(importsConfig.bucket)
    .createSignedUploadUrl(path);

  if (signError) {
    await ctx.db.from("import_jobs").delete().eq("id", job.id);
    throw signError;
  }

  return { importJobId: job.id, signedUrl: signed.signedUrl, token: signed.token, path };
}

export async function getImportJob(ctx: ServiceContext, id: string): Promise<ImportJob> {
  const { data, error } = await ctx.db
    .from("import_jobs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Import job not found");
  return data;
}

export async function listImportJobs(ctx: ServiceContext): Promise<ImportJob[]> {
  const { data, error } = await ctx.db
    .from("import_jobs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// -------------------------------------------------------------------------------------------
// Analyze — parses the uploaded source, materializes import_rows in bulk, returns a preview.
// -------------------------------------------------------------------------------------------

export type AnalyzeImportResult = {
  columns: ColumnPreview[];
  rowCount: number;
  encoding?: string;
  delimiter?: string;
};

const ROW_INSERT_BATCH_SIZE = 1000;

async function analyzeSource(
  filePath: string,
  filename: string,
  kind: ImportKind,
  overrides: AnalysisOptions = {}
): Promise<AnalyzeImportResult & { archiveEntries?: ZipEntryInfo[]; manifestFileName?: string }> {
  const format = detectImportFileFormat(filename);

  if (format === "zip") {
    const entries = await listZipEntries(filePath);
    // A manifest, if present, lives at the archive root (no "/" in its name) — subfolder CSVs
    // are just documents named ".csv", not a manifest.
    const manifestEntry = entries.find(
      (entry) => !entry.fileName.includes("/") && /\.(csv|tsv|xlsx)$/i.test(entry.fileName)
    );

    if (manifestEntry) {
      const manifest = await extractZipEntryToTempFile(filePath, manifestEntry.fileName);
      try {
        const manifestFormat = detectImportFileFormat(manifestEntry.fileName);
        const analyzed =
          manifestFormat === "xlsx"
            ? await analyzeXlsxFile(manifest.path, importsConfig.maxRows)
            : await analyzeDelimitedFile(manifest.path, importsConfig.maxRows, overrides);
        return {
          ...analyzed,
          archiveEntries: entries.filter((e) => e.fileName !== manifestEntry.fileName),
          manifestFileName: manifestEntry.fileName
        };
      } finally {
        await manifest.cleanup();
      }
    }

    if (kind !== "documents") {
      throw new ImportRowError(
        "PARSE_ERROR",
        "This import kind requires a CSV/XLSX file, not a bare archive."
      );
    }

    if (entries.length > importsConfig.maxRows) {
      throw new ImportRowError(
        "PARSE_ERROR",
        `Archive has more than ${importsConfig.maxRows} files — split it before importing`
      );
    }

    // No manifest — every archived file becomes its own unconnected document row, matched 1:1
    // by filename (specs/06-importer.md: "Documents appear... status = processing" applies
    // even with no metadata beyond the filename itself).
    return {
      columns: [
        { index: 0, header: "filename", sample: entries.slice(0, 3).map((e) => e.fileName) }
      ],
      rowCount: entries.length,
      archiveEntries: entries
    };
  }

  if (format === "xlsx") return analyzeXlsxFile(filePath, importsConfig.maxRows);
  return analyzeDelimitedFile(filePath, importsConfig.maxRows, overrides);
}

// Streams every raw row (as string[]) regardless of source shape — the archive-without-
// manifest case synthesizes one column (filename) per entry so materialization has a single
// code path.
async function* streamRawRows(
  filePath: string,
  filename: string,
  archiveEntries: ZipEntryInfo[] | undefined,
  manifestFileName: string | undefined,
  encoding?: string,
  delimiter?: string
): AsyncGenerator<string[]> {
  const format = detectImportFileFormat(filename);

  if (format === "zip") {
    if (manifestFileName) {
      const manifest = await extractZipEntryToTempFile(filePath, manifestFileName);
      try {
        const manifestFormat = detectImportFileFormat(manifestFileName);
        if (manifestFormat === "xlsx") {
          yield* streamXlsxRows(manifest.path);
        } else {
          yield* streamDelimitedRows(manifest.path, {
            encoding: encoding ?? "UTF-8",
            delimiter: (delimiter as "," | ";" | "\t" | undefined) ?? ";"
          });
        }
      } finally {
        await manifest.cleanup();
      }
      return;
    }

    yield ["filename"];
    for (const entry of archiveEntries ?? []) yield [entry.fileName];
    return;
  }

  if (format === "xlsx") {
    yield* streamXlsxRows(filePath);
    return;
  }

  yield* streamDelimitedRows(filePath, {
    encoding: encoding ?? "UTF-8",
    delimiter: (delimiter as "," | ";" | "\t" | undefined) ?? ";"
  });
}

export async function analyzeImportJob(
  ctx: ServiceContext,
  id: string,
  input: AnalysisOptions = {}
): Promise<AnalyzeImportResult> {
  const overrides = analysisOptionsSchema.parse(input);
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["draft", "mapping", "ready"]);
  if (!job.storage_key || !job.source_filename) {
    throw new UnprocessableError("Import job has no uploaded source file yet");
  }

  const temp = await downloadStorageObjectToTempFile(importsConfig.bucket, job.storage_key);
  try {
    const analyzed = await analyzeSource(temp.path, job.source_filename, job.kind, overrides);

    // Materialize every row up front (specs/02-data-model.md: "do not process spreadsheets in
    // memory without materializing rows") — bulk inserts of ~1000, not one insert per row.
    const { error: deleteError } = await admin
      .from("import_rows")
      .delete()
      .eq("import_job_id", id)
      .eq("organization_id", ctx.orgId);
    if (deleteError) throw deleteError;

    let rowNumber = 0;
    let batch: Database["public"]["Tables"]["import_rows"]["Insert"][] = [];
    let isHeaderRow = analyzed.manifestFileName !== undefined || !analyzed.archiveEntries;
    // The synthetic archive-only listing has no header row of its own (streamRawRows yields
    // "filename" as a literal header first) — same skip-first-row rule either way.
    isHeaderRow = true;

    for await (const raw of streamRawRows(
      temp.path,
      job.source_filename,
      analyzed.archiveEntries,
      analyzed.manifestFileName,
      analyzed.encoding,
      analyzed.delimiter
    )) {
      if (isHeaderRow) {
        isHeaderRow = false;
        continue;
      }
      rowNumber++;
      batch.push({
        organization_id: ctx.orgId,
        import_job_id: id,
        row_number: rowNumber,
        raw: raw as unknown as Json
      });
      if (batch.length >= ROW_INSERT_BATCH_SIZE) {
        const { error } = await admin.from("import_rows").insert(batch);
        if (error) throw error;
        batch = [];
      }
    }
    if (batch.length > 0) {
      const { error } = await admin.from("import_rows").insert(batch);
      if (error) throw error;
    }

    const { error: updateError } = await admin
      .from("import_jobs")
      .update({
        status: "mapping",
        total_rows: rowNumber,
        options: {
          ...((job.options as Record<string, Json>) ?? {}),
          analysis: {
            columns: analyzed.columns,
            rowCount: rowNumber,
            encoding: analyzed.encoding ?? null,
            delimiter: analyzed.delimiter ?? null
          },
          validation: null
        } as unknown as Json
      })
      .eq("id", id)
      .eq("organization_id", ctx.orgId);
    if (updateError) throw updateError;

    await logEvent({
      actorId: ctx.actorId,
      action: "import.analyzed",
      entityType: "import_job",
      entityId: id,
      organizationId: ctx.orgId,
      metadata: { rowCount: rowNumber, kind: job.kind }
    });

    return {
      columns: analyzed.columns,
      rowCount: analyzed.rowCount,
      encoding: analyzed.encoding,
      delimiter: analyzed.delimiter
    };
  } finally {
    await temp.cleanup();
  }
}

// -------------------------------------------------------------------------------------------
// Mapping
// -------------------------------------------------------------------------------------------

export async function updateImportMapping(
  ctx: ServiceContext,
  id: string,
  rawMapping: unknown
): Promise<ImportJob> {
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["mapping", "ready"]);

  const schema = mappingSchemaForKind(job.kind);
  const parsed = schema.safeParse(rawMapping);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }

  // Re-mapping after a validate() always requires revalidation — never leave a job "ready"
  // against a mapping the review screen never actually saw.
  const { data, error } = await admin
    .from("import_jobs")
    .update({
      mapping: parsed.data as Json,
      status: "mapping",
      options: { ...((job.options as Record<string, Json>) ?? {}), validation: null }
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();
  if (error) throw error;

  return data;
}

export async function saveImportMapping(
  ctx: ServiceContext,
  input: { name: string; kind: ImportKind; mapping: ImportMapping }
): Promise<ImportMappingRecord> {
  const schema = mappingSchemaForKind(input.kind);
  const parsed = schema.parse(input.mapping);

  const { data, error } = await ctx.db
    .from("import_mappings")
    .upsert(
      {
        organization_id: ctx.orgId,
        name: input.name,
        kind: input.kind,
        mapping: parsed as Json,
        created_by: ctx.actorId
      },
      { onConflict: "organization_id,name" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listImportMappings(
  ctx: ServiceContext,
  kind?: ImportKind
): Promise<ImportMappingRecord[]> {
  let query = ctx.db.from("import_mappings").select("*").eq("organization_id", ctx.orgId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// -------------------------------------------------------------------------------------------
// Validate — dry run over every row, writes verdicts only, never entities/connections/documents.
// -------------------------------------------------------------------------------------------

export type ValidateImportSummary = {
  /** Subset of failed rows for which a referenced record/document was not found. */
  unmatched?: number;
  ok: number;
  skippedDuplicate: number;
  needsReview: number;
  failed: number;
};

const VALIDATE_PAGE_SIZE = 200;

export async function validateImportJob(
  ctx: ServiceContext,
  id: string
): Promise<ValidateImportSummary> {
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["mapping", "ready"]);

  const schema = mappingSchemaForKind(job.kind);
  const mappingParsed = schema.safeParse(job.mapping);
  if (!mappingParsed.success) {
    throw new UnprocessableError(
      "Import mapping is missing or invalid — map the file before validating"
    );
  }

  const { error: statusError } = await admin
    .from("import_jobs")
    .update({ status: "validating" })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (statusError) throw statusError;

  try {
    const archiveEntries = await loadArchiveEntriesIfNeeded(job);
    const summary: ValidateImportSummary = {
      ok: 0,
      skippedDuplicate: 0,
      needsReview: 0,
      failed: 0
    };

    let lastId = 0;
    for (;;) {
      const { data: page, error } = await admin
        .from("import_rows")
        .select("id, row_number, raw")
        .eq("organization_id", ctx.orgId)
        .eq("import_job_id", id)
        .gt("id", lastId)
        .order("id", { ascending: true })
        .limit(VALIDATE_PAGE_SIZE);
      if (error) throw error;
      if (!page || page.length === 0) break;

      const rows: RawImportRow[] = page.map((r) => ({
        rowNumber: r.row_number,
        raw: r.raw as unknown as string[]
      }));

      const plans =
        job.kind === "entities"
          ? await resolveEntityRowPlans(ctx, mappingParsed.data as EntityImportMapping, rows)
          : await resolveDocumentRowPlans(ctx, job.kind, {
              // mappingSchemaForKind(job.kind) already validated this against the right schema
              // for this specific job's kind above — TS can't correlate that dynamic dispatch
              // back to a literal type, so this asserts what's already been checked at runtime.
              mapping: mappingParsed.data as DocumentImportMapping | MetadataOnlyImportMapping,
              rows,
              archiveEntries
            });

      const updates = page.map((r) => {
        const plan = plans.get(r.row_number);
        const verdict = planToVerdict(plan);
        summary[verdict.summaryKey]++;
        if (
          verdict.errorCode === "ENTITY_NOT_FOUND" ||
          verdict.errorCode === "DOCUMENT_NOT_FOUND"
        ) {
          summary.unmatched = (summary.unmatched ?? 0) + 1;
        }
        return {
          id: r.id,
          status: verdict.status,
          result: verdict.result as Json,
          error_code: verdict.errorCode ?? null,
          error_message: verdict.errorMessage ?? null
        };
      });

      const { error: bulkError } = await admin.rpc("bulk_update_import_rows", {
        p_import_job_id: id,
        p_organization_id: ctx.orgId,
        p_rows: updates as unknown as Json
      });
      if (bulkError) throw bulkError;

      lastId = page[page.length - 1].id;
    }

    const { error: finishError } = await admin
      .from("import_jobs")
      .update({
        status: "ready",
        processed_rows: summary.failed + summary.needsReview,
        failed_rows: summary.failed + summary.needsReview,
        succeeded_rows: 0,
        skipped_rows: 0,
        options: {
          ...((job.options as Record<string, Json>) ?? {}),
          validation: summary
        } as unknown as Json
      })
      .eq("id", id)
      .eq("organization_id", ctx.orgId);
    if (finishError) throw finishError;

    await logEvent({
      actorId: ctx.actorId,
      action: "import.validated",
      entityType: "import_job",
      entityId: id,
      organizationId: ctx.orgId,
      metadata: summary
    });

    return summary;
  } catch (error) {
    await admin
      .from("import_jobs")
      .update({ status: "mapping" })
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .eq("status", "validating");
    throw error;
  }
}

type RowVerdict = {
  status: ImportRow["status"];
  result: Record<string, unknown>;
  errorCode?: ImportErrorCode;
  errorMessage?: string;
  summaryKey: "ok" | "skippedDuplicate" | "needsReview" | "failed";
};

// specs/06-importer.md: "VALIDATE: dry run over ALL rows; writes nothing [to business data];
// produces per-row verdicts." Critical distinction this function encodes: `status` here is
// what gets WRITTEN to import_rows.status, which is also the exact column
// claim_import_chunk() reads to find work for the real run — so only a plan that is
// *permanently* bad (an "error" action; the same outcome would recur unchanged at run time)
// gets a terminal status here. Every executable plan (create/update/skip_duplicate/
// connect_existing/create_document) is written back as "pending", never "ok" or
// "skipped_duplicate" — those verdicts describe what running the plan *would* do, not that it
// has been done. Getting this wrong silently starves the real run: an early version of this
// function wrote the *real* terminal status during validate(), which left nothing in `pending`
// for claim_import_chunk() to ever find — caught live during Phase 3 M6 verification, not by
// a unit test (the mocked-DB tests never exercise the actual claim query). `summaryKey` is
// unaffected by this — the review screen's "N ok / N duplicates / N needs review / N failed"
// counts still reflect what each row's plan actually resolves to.
function planToVerdict(plan: unknown): RowVerdict {
  const p = plan as
    | {
        action?: string;
        code?: ImportErrorCode;
        message?: string;
        needsReview?: boolean;
        reviewCode?: ImportErrorCode;
        reviewMessage?: string;
      }
    | undefined;

  if (!p) {
    return {
      status: "failed",
      result: {},
      errorCode: "UNKNOWN",
      errorMessage: "No plan resolved for this row",
      summaryKey: "failed"
    };
  }

  if (p.action === "error") {
    const needsReviewCodes: ImportErrorCode[] = ["IDENTIFIER_CONFLICT", "DUPLICATE"];
    const isNeedsReview = needsReviewCodes.includes(p.code as ImportErrorCode);
    return {
      status: isNeedsReview ? "needs_review" : "failed",
      result: {},
      errorCode: p.code,
      errorMessage: p.message,
      summaryKey: isNeedsReview ? "needsReview" : "failed"
    };
  }

  if (p.action === "skip_duplicate") {
    return {
      status: "pending",
      result: p as Record<string, unknown>,
      errorCode: p.reviewCode,
      errorMessage: p.reviewMessage,
      summaryKey: p.needsReview ? "needsReview" : "skippedDuplicate"
    };
  }

  return {
    status: "pending",
    result: p as Record<string, unknown>,
    errorCode: p.reviewCode,
    errorMessage: p.reviewMessage,
    summaryKey: p.needsReview ? "needsReview" : "ok"
  };
}

async function loadArchiveEntriesIfNeeded(job: ImportJob): Promise<ZipEntryInfo[] | undefined> {
  const opened = await openJobArchive(job);
  if (!opened) return undefined;
  await opened.tempFile.cleanup();
  return opened.entries;
}

// -------------------------------------------------------------------------------------------
// Run control — Milestone 6 owns the actual chunk executor (worker/jobs/run-import-chunk.ts);
// these transitions + the Redis control flag it reads are the entry points into that.
// -------------------------------------------------------------------------------------------

export async function startImportJob(ctx: ServiceContext, id: string): Promise<ImportJob> {
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["ready"]);

  await setImportControl(id, "running");

  // Enqueue up to the per-org concurrency cap — claim_import_chunk()'s own `for update skip
  // locked` makes concurrent claims safe; each chunk re-enqueues itself on completion
  // (worker/jobs/run-import-chunk.ts), so this is the only place that starts more than one.
  for (let i = 0; i < importsConfig.defaultConcurrencyPerOrganization; i++) {
    await enqueue(QUEUE_NAMES.runImportChunk, { orgId: ctx.orgId, importJobId: id });
  }

  await logEvent({
    actorId: ctx.actorId,
    action: "import.started",
    entityType: "import_job",
    entityId: id,
    organizationId: ctx.orgId
  });

  return job;
}

export async function pauseImportJob(ctx: ServiceContext, id: string): Promise<ImportJob> {
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["running"]);

  await setImportControl(id, "paused");
  const { data, error } = await admin
    .from("import_jobs")
    .update({ status: "paused" })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function resumeImportJob(ctx: ServiceContext, id: string): Promise<ImportJob> {
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["paused"]);

  await setImportControl(id, "running");
  const { data, error } = await admin
    .from("import_jobs")
    .update({ status: "running" })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();
  if (error) throw error;

  for (let i = 0; i < importsConfig.defaultConcurrencyPerOrganization; i++) {
    await enqueue(QUEUE_NAMES.runImportChunk, { orgId: ctx.orgId, importJobId: id });
  }

  return data;
}

export async function cancelImportJob(ctx: ServiceContext, id: string): Promise<ImportJob> {
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["running", "paused", "ready"]);

  await setImportControl(id, "cancelled");
  const { data, error } = await admin
    .from("import_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("*")
    .single();
  if (error) throw error;

  await logEvent({
    actorId: ctx.actorId,
    action: "import.cancelled",
    entityType: "import_job",
    entityId: id,
    organizationId: ctx.orgId
  });

  return data;
}

export async function retryFailedRows(ctx: ServiceContext, id: string): Promise<{ count: number }> {
  await assertOrgWriteAccess(ctx);
  const admin = createAdminClient();
  const job = await fetchImportJob(admin, ctx.orgId, id);
  assertStatus(job, ["completed_with_errors", "failed", "paused"]);

  // specs/03-api.md: "Re-queues only failed rows" — never touches ok/skipped_duplicate rows,
  // so a partial success is never reprocessed.
  // Exact affected-row count avoids both transferring every id and PostgREST's response-row cap.
  const { count: affectedRows, error } = await admin
    .from("import_rows")
    .update(
      { status: "pending", attempts: 0, error_code: null, error_message: null },
      { count: "exact" }
    )
    .eq("organization_id", ctx.orgId)
    .eq("import_job_id", id)
    .eq("status", "failed");
  if (error) throw error;

  const count = affectedRows ?? 0;
  if (count === 0) return { count: 0 };

  const { error: updateError } = await admin
    .from("import_jobs")
    .update({
      status: "ready",
      failed_rows: Math.max(0, job.failed_rows - count),
      processed_rows: Math.max(0, job.processed_rows - count),
      finished_at: null
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (updateError) throw updateError;

  return { count };
}

// -------------------------------------------------------------------------------------------
// Rows + report
// -------------------------------------------------------------------------------------------

export async function listImportRows(
  ctx: ServiceContext,
  importJobId: string,
  options: { status?: ImportRow["status"]; cursor?: string | null; limit?: number } = {}
): Promise<{ items: ImportRow[]; nextCursor: string | null }> {
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(100, Math.trunc(options.limit!)))
    : 50;
  let query = ctx.db
    .from("import_rows")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("import_job_id", importJobId);

  if (options.status) query = query.eq("status", options.status);

  const cursorId = options.cursor
    ? Number(Buffer.from(options.cursor, "base64url").toString("utf8"))
    : null;
  if (cursorId) query = query.gt("id", cursorId);

  query = query.order("id", { ascending: true }).limit(limit + 1);

  const { data, error } = await query;
  if (error) throw error;

  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? Buffer.from(String(last.id), "utf8").toString("base64url") : null
  };
}

/** Count upload/OCR outcomes separately from rows handed off by the chunk executor. */
export async function getImportDocumentProgress(ctx: ServiceContext, id: string) {
  const count = async (statuses?: ImportJobUploadStatus[]) => {
    let query = ctx.db
      .from("document_uploads")
      .select("id, import_rows!inner(import_job_id)", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .eq("import_rows.import_job_id", id);
    if (statuses) query = query.in("status", statuses);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };
  const [total, completed, failed] = await Promise.all([
    count(),
    count(["completed"]),
    count(["failed", "expired"])
  ]);
  return { total, completed, failed, pending: Math.max(0, total - completed - failed) };
}
type ImportJobUploadStatus = Database["public"]["Tables"]["document_uploads"]["Row"]["status"];
