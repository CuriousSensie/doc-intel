import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/events/sinks/console-sink");
  vi.doUnmock("@/lib/events/sinks/audit-log-sink");
  vi.resetModules();
});

describe("logEvent", () => {
  it("calls every sink with the event", async () => {
    const consoleHandle = vi.fn().mockResolvedValue(undefined);
    const auditHandle = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/events/sinks/console-sink", () => ({
      consoleSink: { name: "console", handle: consoleHandle }
    }));
    vi.doMock("@/lib/events/sinks/audit-log-sink", () => ({
      auditLogSink: { name: "audit_log", handle: auditHandle }
    }));

    const { logEvent } = await import("@/lib/events/index");
    const event = { actorId: "user-1", action: "test.event" };
    await logEvent(event);

    expect(consoleHandle).toHaveBeenCalledWith(event);
    expect(auditHandle).toHaveBeenCalledWith(event);
  });

  it("does not let one sink's failure block another sink or throw", async () => {
    const auditHandle = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/events/sinks/console-sink", () => ({
      consoleSink: { name: "console", handle: vi.fn().mockRejectedValue(new Error("boom")) }
    }));
    vi.doMock("@/lib/events/sinks/audit-log-sink", () => ({
      auditLogSink: { name: "audit_log", handle: auditHandle }
    }));

    const { logEvent } = await import("@/lib/events/index");

    await expect(logEvent({ actorId: null, action: "test.event" })).resolves.toBeUndefined();
    expect(auditHandle).toHaveBeenCalled();
  });
});
