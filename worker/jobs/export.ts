import type { Job } from "bullmq";

import { exportsConfig } from "@/config/exports";
import { describeError } from "@/lib/errors";
import { buildCsv, buildXlsx } from "@/modules/exports/file-builders";
import { resolveExportData } from "@/modules/exports/exports.service";
import {
  completeBackgroundOperation,
  failBackgroundOperation
} from "@/modules/background-operations/background-operations.service";

import { contextForJob, type JobPayload } from "../context";

type ExportPayload = JobPayload & {
  operationId: string;
  documentIds: string[];
  format: "csv" | "xlsx";
};

export async function exportJob(job: Job<JobPayload>): Promise<void> {
  const payload = job.data as ExportPayload;
  const ctx = contextForJob(job);

  try {
    const data = await resolveExportData(ctx, payload.documentIds);
    const extension = payload.format === "xlsx" ? "xlsx" : "csv";
    const storagePath = `${ctx.orgId}/${payload.operationId}.${extension}`;

    const body =
      payload.format === "xlsx" ? await buildXlsx(data) : Buffer.from(buildCsv(data), "utf-8");
    const contentType =
      payload.format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8";

    const { error: uploadError } = await ctx.db.storage
      .from(exportsConfig.bucket)
      .upload(storagePath, body, { contentType, upsert: true });
    if (uploadError) throw uploadError;

    await completeBackgroundOperation(ctx, payload.operationId, {
      successCount: data.rows.length,
      failureCount: 0,
      result: { storagePath, rowCount: data.rows.length, format: payload.format }
    });
  } catch (error) {
    await failBackgroundOperation(
      ctx,
      payload.operationId,
      describeError(error)
    );
    throw error;
  }
}
