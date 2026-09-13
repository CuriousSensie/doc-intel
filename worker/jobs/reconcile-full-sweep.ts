import { reconcileFullSweep } from "@/modules/documents/reconcile-full-sweep";

// Global sweep, not tenant-scoped — same convention as expire-abandoned-uploads.ts. Loops over
// every ready tenant internally; job.data.orgId is an unused placeholder.
export async function reconcileFullSweepJob(): Promise<void> {
  await reconcileFullSweep();
}
