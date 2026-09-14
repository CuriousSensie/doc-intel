import { NotFoundError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/service-context";
import type { Database, Json } from "@/types/database";

export type BackgroundOperation = Database["public"]["Tables"]["background_operations"]["Row"];
export type BackgroundOperationKind = BackgroundOperation["kind"];

export async function createBackgroundOperation(
  ctx: ServiceContext,
  input: { kind: BackgroundOperationKind; params: Record<string, unknown>; totalCount?: number }
): Promise<BackgroundOperation> {
  const { data, error } = await ctx.db
    .from("background_operations")
    .insert({
      organization_id: ctx.orgId,
      kind: input.kind,
      params: input.params as Json,
      total_count: input.totalCount ?? null,
      created_by: ctx.actorId
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getBackgroundOperation(
  ctx: ServiceContext,
  id: string
): Promise<BackgroundOperation> {
  const { data, error } = await ctx.db
    .from("background_operations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("Operation not found");
  return data;
}

// Worker-only (job context's admin client bypasses RLS — background_operations has
// deliberately no update policy, same convention as document_uploads).
export async function updateBackgroundOperationProgress(
  ctx: ServiceContext,
  id: string,
  progress: { processedCount: number; successCount?: number; failureCount?: number }
): Promise<void> {
  const { error } = await ctx.db
    .from("background_operations")
    .update({
      status: "processing",
      processed_count: progress.processedCount,
      ...(progress.successCount !== undefined ? { success_count: progress.successCount } : {}),
      ...(progress.failureCount !== undefined ? { failure_count: progress.failureCount } : {})
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;
}

export async function completeBackgroundOperation(
  ctx: ServiceContext,
  id: string,
  outcome: {
    successCount: number;
    failureCount: number;
    failures?: Array<{ id: string; error: string }>;
    result?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await ctx.db
    .from("background_operations")
    .update({
      status: "completed",
      success_count: outcome.successCount,
      failure_count: outcome.failureCount,
      processed_count: outcome.successCount + outcome.failureCount,
      failures: (outcome.failures ?? []) as Json,
      result: (outcome.result ?? null) as Json,
      completed_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;
}

export async function failBackgroundOperation(
  ctx: ServiceContext,
  id: string,
  errorMessage: string
): Promise<void> {
  const { error } = await ctx.db
    .from("background_operations")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) throw error;
}
