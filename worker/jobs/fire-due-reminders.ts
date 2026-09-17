import { fireDueReminders } from "@/modules/rules/fire-due-reminders";

// Global sweep, not tenant-scoped — mirrors expire-abandoned-uploads.ts's own job.data.orgId
// placeholder convention.
export async function fireDueRemindersJob(): Promise<void> {
  await fireDueReminders();
}
