"use server";

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
import type { ImportKind } from "./imports.schemas";

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
  return createImportJob(ctx, input);
}

export async function getImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return getImportJob(ctx, id);
}

export async function listImportJobsAction() {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return listImportJobs(ctx);
}

export async function analyzeImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return analyzeImportJob(ctx, id);
}

export async function updateImportMappingAction(id: string, mapping: unknown) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return updateImportMapping(ctx, id, mapping);
}

export async function validateImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return validateImportJob(ctx, id);
}

export async function startImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return startImportJob(ctx, id);
}

export async function pauseImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return pauseImportJob(ctx, id);
}

export async function resumeImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return resumeImportJob(ctx, id);
}

export async function cancelImportJobAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return cancelImportJob(ctx, id);
}

export async function retryFailedRowsAction(id: string) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return retryFailedRows(ctx, id);
}

export async function listImportRowsAction(
  id: string,
  options: { status?: ImportRow["status"]; cursor?: string | null; limit?: number } = {}
) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return listImportRows(ctx, id, options);
}

export async function saveImportMappingAction(input: {
  name: string;
  kind: ImportKind;
  mapping: unknown;
}) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return saveImportMapping(ctx, input as Parameters<typeof saveImportMapping>[1]);
}

export async function listImportMappingsAction(kind?: ImportKind) {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  return listImportMappings(ctx, kind);
}
