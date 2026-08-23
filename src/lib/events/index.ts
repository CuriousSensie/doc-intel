import { logger } from "@/lib/logger";
import { auditLogSink } from "@/lib/events/sinks/audit-log-sink";
import { consoleSink } from "@/lib/events/sinks/console-sink";
import type { AppEvent, EventSink } from "@/lib/events/types";

const sinks: EventSink[] = [consoleSink, auditLogSink];

export type { AppEvent, EventSink } from "@/lib/events/types";

/**
 * Fans an event out to every configured sink. Never throws — a sink failure is logged and
 * skipped so it can never block the mutation that triggered it, matching sendEmail()'s
 * never-throw convention. Add a new destination by writing one more EventSink and pushing it
 * into `sinks`; no caller anywhere else needs to change.
 */
export async function logEvent(event: AppEvent): Promise<void> {
  await Promise.all(
    sinks.map(async (sink) => {
      try {
        await sink.handle(event);
      } catch (error) {
        logger.error("event.sink_failed", {
          sink: sink.name,
          action: event.action,
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        });
      }
    })
  );
}
