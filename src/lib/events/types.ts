import type { Json } from "@/types/database";

export type AppEvent = {
  actorId: string | null;
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
