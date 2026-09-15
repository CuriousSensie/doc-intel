import { pollPaperlessTasks } from "@/modules/documents/poll-paperless-tasks";

// Global sweep, not tenant-scoped (job.data.orgId is an unused placeholder — see worker/
// index.ts's registerSchedules(), same convention as expire-abandoned-uploads.ts and both
// reconcile-*.ts jobs) — it loops over every org with pending tracked tasks internally.
export async function pollPaperlessTasksJob(): Promise<void> {
  await pollPaperlessTasks();
}
