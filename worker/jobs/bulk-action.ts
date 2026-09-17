import type { Job } from "bullmq";

import { describeError } from "@/lib/errors";
import { bulkCreateConnections, type ConnectableKind, type Relation } from "@/modules/connections/connections.service";
import {
  completeBackgroundOperation,
  failBackgroundOperation,
  updateBackgroundOperationProgress
} from "@/modules/background-operations/background-operations.service";

import { contextForJob, type JobPayload } from "../context";

type BulkConnectPayload = JobPayload & {
  operationId: string;
  sourceKind: ConnectableKind;
  sourceIds: string[];
  targetKind: ConnectableKind;
  targetId: string;
  relation?: Relation;
};

// specs/05-level-1-structure.md §Bulk business actions: "async execution above 50 items with
// progress, per-item failure reporting" — documents.actions.ts only enqueues this job once a
// selection crosses that threshold; smaller batches run inline (see bulkConnectAction).
const PROGRESS_UPDATE_INTERVAL = 25;

export async function bulkActionJob(job: Job<JobPayload>): Promise<void> {
  const payload = job.data as BulkConnectPayload;
  const ctx = contextForJob(job);

  try {
    const result = await bulkCreateConnections(
      ctx,
      {
        sourceKind: payload.sourceKind,
        sourceIds: payload.sourceIds,
        targetKind: payload.targetKind,
        targetId: payload.targetId,
        relation: payload.relation,
        createdVia: "bulk"
      },
      async (processed, total) => {
        if (processed % PROGRESS_UPDATE_INTERVAL === 0 || processed === total) {
          await updateBackgroundOperationProgress(ctx, payload.operationId, {
            processedCount: processed
          });
        }
      }
    );

    await completeBackgroundOperation(ctx, payload.operationId, {
      successCount: result.createdIds.length,
      failureCount: result.failures.length,
      failures: result.failures,
      result: { connectionIds: result.createdIds, skippedIds: result.skippedIds }
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
