import IORedis, { type Redis } from "ioredis";

import { env } from "@/lib/env";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  return client;
}
