"use server";

import { toSafeError } from "@/lib/errors";
import { ImportRowError } from "@/lib/import/errors";
import { ZodError } from "zod";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";

import {
  analyzeImportJob,
  cancelImportJob,
  createImportJob,
  getImportJob,
  listImportJobs,
  listImportMappings,
  listImportRows,
  pauseImportJob,
  resumeImportJob,
  retryFailedRows,
  saveImportMapping,
  startImportJob,
  updateImportMapping,
  validateImportJob,
  type ImportRow
} from "./imports.service";
import type { ImportKind, AnalysisOptions } from "./imports.schemas";

// docs/adr/0009-route-handlers-vs-server-actions.md: import CRUD is a Server Action, same as
// every other module's mutations — polling/report download are the Route Handlers
// (src/app/api/imports/[id]/route.ts, .../report/route.ts).

export async function createImportJobAction(input: {
  kind: ImportKind;
  filename: string;
  size: number;
  fromMappingId?: string;
}) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => createImportJob(ctx, input));
}

export async function getImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => getImportJob(ctx, id));
}

export async function listImportJobsAction() {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => listImportJobs(ctx));
}

export async function analyzeImportJobAction(id: string, options: AnalysisOptions = {}) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => analyzeImportJob(ctx, id, options));
}

export async function updateImportMappingAction(id: string, mapping: unknown) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => updateImportMapping(ctx, id, mapping));
}

export async function validateImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => validateImportJob(ctx, id));
}

export async function startImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => startImportJob(ctx, id));
}

export async function pauseImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => pauseImportJob(ctx, id));
}

export async function resumeImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => resumeImportJob(ctx, id));
}

export async function cancelImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => cancelImportJob(ctx, id));
}

export async function retryFailedRowsAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => retryFailedRows(ctx, id));
}

export async function listImportRowsAction(
  id: string,
  options: { status?: ImportRow["status"]; cursor?: string | null; limit?: number } = {}
) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => listImportRows(ctx, id, options));
}

export async function saveImportMappingAction(input: {
  name: string;
  kind: ImportKind;
  mapping: unknown;
}) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() =>
    saveImportMapping(ctx, input as Parameters<typeof saveImportMapping>[1])
  );
}

export async function listImportMappingsAction(kind?: ImportKind) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return actionResult(() => listImportMappings(ctx, kind));
}

async function actionResult<T>(
  run: () => Promise<T>
): Promise<{ data: T; error?: never } | { data?: never; error: string }> {
  try {
    return { data: await run() };
  } catch (error) {
    if (error instanceof ImportRowError) return { error: error.message };
    if (error instanceof ZodError)
      return { error: error.issues.map((issue) => issue.message).join("; ") };
    return { error: toSafeError(error).message };
  }
}
