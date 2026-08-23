import { createAdminClient } from "@/lib/supabase/admin";
import type { EventSink } from "@/lib/events/types";

export const auditLogSink: EventSink = {
  name: "audit_log",
  async handle(event) {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      actor_id: event.actorId,
      organization_id: event.organizationId ?? null,
      action: event.action,
      entity_type: event.entityType ?? null,
      entity_id: event.entityId ?? null,
      metadata: event.metadata ?? {},
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent ?? null
    });

    if (error) {
      throw error;
    }
  }
};
