import type { Json } from "@/types/database";

export type AppEvent = {
  actorId: string | null;
  // ADR-0005 — defaults to "user" in the sink to match every existing caller.
  actorType?: "user" | "system" | "rule" | "import" | "ai";
  action: string;
  entityType?: string;
  entityId?: string;
  organizationId?: string | null;
  metadata?: Json;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type EventSink = {
  name: string;
  handle(event: AppEvent): Promise<void>;
};
