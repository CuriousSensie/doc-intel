import { afterEach, describe, expect, it, vi } from "vitest";

describe("token bucket", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns remaining tokens when Redis grants a token", async () => {
    const evalMock = vi.fn().mockResolvedValue([1, 119, 0]);
    vi.doMock("@/lib/redis", () => ({ getRedisClient: () => ({ eval: evalMock }) }));

    const { takeOrgToken } = await import("@/lib/ratelimit/token-bucket");

    await expect(takeOrgToken("org-1", "paperless:upload")).resolves.toEqual({
      allowed: true,
      remaining: 119
    });
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call"),
      1,
      "rate:paperless:upload:org-1",
      expect.any(String),
      "120",
      "0.002",
      "120000"
    );
  });

  it("raises a typed delay when the org bucket is empty", async () => {
    vi.doMock("@/lib/redis", () => ({
      getRedisClient: () => ({ eval: vi.fn().mockResolvedValue([0, 0, 250]) })
    }));

    const { OrgRateLimitExceededError, requireOrgToken } =
      await import("@/lib/ratelimit/token-bucket");

    await expect(requireOrgToken("org-1", "paperless:read")).rejects.toMatchObject({
      orgId: "org-1",
      bucket: "paperless:read",
      retryAfterMs: 250
    });
    await expect(requireOrgToken("org-1", "paperless:read")).rejects.toBeInstanceOf(
      OrgRateLimitExceededError
    );
  });
});
