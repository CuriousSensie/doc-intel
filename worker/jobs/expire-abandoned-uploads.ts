import { expireAbandonedUploads } from "@/modules/documents/expire-abandoned-uploads";

// Global sweep, not tenant-scoped — job.data.orgId is unused (worker/index.ts's
// registerSchedules() only carries a placeholder value so it satisfies enqueue()'s
// `{orgId: string}` payload constraint).
export async function expireAbandonedUploadsJob(): Promise<void> {
  await expireAbandonedUploads();
}
