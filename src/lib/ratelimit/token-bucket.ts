import { env } from "@/lib/env";
import { getRedisClient } from "@/lib/redis";

type BucketKind = "paperless:read" | "paperless:upload";

type TokenBucket = {
  key: string;
  capacity: number;
  refillPerSecond: number;
};

export type TokenBucketResult =
  { allowed: true; remaining: number } | { allowed: false; retryAfterMs: number };

export class OrgRateLimitExceededError extends Error {
  constructor(
    public readonly orgId: string,
    public readonly bucket: BucketKind,
    public readonly retryAfterMs: number
  ) {
    super(`Rate limit exceeded for ${bucket}`);
  }
}

const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_per_ms = tonumber(ARGV[3])
local ttl_ms = tonumber(ARGV[4])

local bucket = redis.call("HMGET", key, "tokens", "updated_at")
local tokens = tonumber(bucket[1])
local updated_at = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  updated_at = now
else
  local elapsed = math.max(0, now - updated_at)
  tokens = math.min(capacity, tokens + (elapsed * refill_per_ms))
  updated_at = now
end

if tokens >= 1 then
  tokens = tokens - 1
  redis.call("HMSET", key, "tokens", tokens, "updated_at", updated_at)
  redis.call("PEXPIRE", key, ttl_ms)
  return {1, math.floor(tokens), 0}
end

local retry_after_ms = math.ceil((1 - tokens) / refill_per_ms)
redis.call("HMSET", key, "tokens", tokens, "updated_at", updated_at)
redis.call("PEXPIRE", key, ttl_ms)
return {0, 0, retry_after_ms}
`;

function bucketFor(orgId: string, bucket: BucketKind): TokenBucket {
  const capacity =
    bucket === "paperless:upload"
      ? env.PAPERLESS_UPLOADS_PER_ORG_PER_MINUTE
      : env.PAPERLESS_READS_PER_ORG_PER_MINUTE;

  return {
    key: `rate:${bucket}:${orgId}`,
    capacity,
    refillPerSecond: capacity / 60
  };
}

export async function takeOrgToken(orgId: string, bucket: BucketKind): Promise<TokenBucketResult> {
  const config = bucketFor(orgId, bucket);
  const now = Date.now();
  const refillPerMs = config.refillPerSecond / 1_000;
  const ttlMs = Math.ceil((config.capacity / config.refillPerSecond) * 2_000);

  const result = (await getRedisClient().eval(
    LUA_TOKEN_BUCKET,
    1,
    config.key,
    String(now),
    String(config.capacity),
    String(refillPerMs),
    String(ttlMs)
  )) as [number, number, number];

  if (result[0] === 1) {
    return { allowed: true, remaining: result[1] };
  }

  return { allowed: false, retryAfterMs: Math.max(1, result[2]) };
}

export async function requireOrgToken(orgId: string, bucket: BucketKind): Promise<void> {
  const result = await takeOrgToken(orgId, bucket);
  if (!result.allowed) {
    throw new OrgRateLimitExceededError(orgId, bucket, result.retryAfterMs);
  }
}
