import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/modules/notifications/notifications.service";

// specs/07-rules-engine.md §Actions: create_reminder is delivered via "Documenti's
// notification and email infrastructure" — no new task system. Global sweep (not tenant-scoped),
// same shape as expire-abandoned-uploads.ts: selects every due, unfired reminder across every
// tenant and notifies its assignee role's members.
export async function fireDueReminders(): Promise<number> {
  const db = createAdminClient();

  const { data: reminders, error } = await db
    .from("reminders")
    .select("id, organization_id, document_id, entity_id, assignee_role, message")
    .lte("due_date", new Date().toISOString().slice(0, 10))
    .is("fired_at", null);
  if (error) throw error;
  if (!reminders || reminders.length === 0) return 0;

  for (const reminder of reminders) {
    try {
      const { data: members, error: membersError } = await db
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", reminder.organization_id)
        .eq("role", reminder.assignee_role);
      if (membersError) throw membersError;

      await Promise.all(
        (members ?? []).map((m) =>
          createNotification(m.user_id, {
            type: "reminder.due",
            title: "Reminder",
            message: reminder.message,
            metadata: {
              reminderId: reminder.id,
              documentId: reminder.document_id,
              entityId: reminder.entity_id
            }
          })
        )
      );

      const { error: fireError } = await db
        .from("reminders")
        .update({ fired_at: new Date().toISOString() })
        .eq("id", reminder.id);
      if (fireError) throw fireError;
    } catch (err) {
      logger.error("rules.fire_due_reminders.failed", {
        reminderId: reminder.id,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return reminders.length;
}
