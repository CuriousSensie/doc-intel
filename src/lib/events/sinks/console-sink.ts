import { logger } from "@/lib/logger";
import type { EventSink } from "@/lib/events/types";

export const consoleSink: EventSink = {
  name: "console",
  async handle(event) {
    logger.info(`event.${event.action}`, {
      actorId: event.actorId,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      organizationId: event.organizationId ?? null
    });
  }
};
