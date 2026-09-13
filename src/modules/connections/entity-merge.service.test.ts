import { describe, expect, it, vi } from "vitest";

import { mergeEntities } from "@/modules/connections/entity-merge.service";
import type { ServiceContext } from "@/lib/service-context";

function makeCtx(rpc: ServiceContext["db"]["rpc"]): ServiceContext {
  return {
    db: { rpc } as unknown as ServiceContext["db"],
    orgId: "org-1",
    actorId: "user-1",
    correlationId: "corr-1"
  };
}

describe("mergeEntities", () => {
  it("resolves when the RPC succeeds", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await expect(
      mergeEntities(makeCtx(rpc), { keepId: "e1", mergeId: "e2" })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("merge_entities", { p_keep_id: "e1", p_merge_id: "e2" });
  });

  it("maps an unauthenticated RPC error to AuthenticationError", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "Authentication required" } });
    await expect(mergeEntities(makeCtx(rpc), { keepId: "e1", mergeId: "e2" })).rejects.toThrow(
      /Authentication required/
    );
  });

  it("maps a not-authorized RPC error to AuthorizationError", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { message: "Not authorized to merge entities in this organization" } });
    await expect(mergeEntities(makeCtx(rpc), { keepId: "e1", mergeId: "e2" })).rejects.toThrow(
      /Not authorized/
    );
  });

  it("maps a cross-organization RPC error to ValidationError", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { message: "Cannot merge entities across organizations" } });
    await expect(mergeEntities(makeCtx(rpc), { keepId: "e1", mergeId: "e2" })).rejects.toThrow(
      /across organizations/
    );
  });

  it("maps a self-merge RPC error to ValidationError", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "Cannot merge an entity into itself" } });
    await expect(mergeEntities(makeCtx(rpc), { keepId: "e1", mergeId: "e1" })).rejects.toThrow(
      /into itself/
    );
  });

  it("rethrows an unrecognized RPC error as-is", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "something else entirely" } });
    await expect(mergeEntities(makeCtx(rpc), { keepId: "e1", mergeId: "e2" })).rejects.toThrow(
      /something else entirely/
    );
  });
});
