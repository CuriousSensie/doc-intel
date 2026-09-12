import { reconcileIncremental } from "@/modules/documents/reconcile-incremental";

// Global sweep, not tenant-scoped — same convention as expire-abandoned-uploads.ts. Loops over
// every ready tenant internally; job.data.orgId is an unused placeholder.
export async function reconcileIncrementalJob(): Promise<void> {
  await reconcileIncremental();
}
