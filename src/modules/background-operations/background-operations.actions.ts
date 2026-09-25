"use server";

import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { getBackgroundOperation } from "@/modules/background-operations/background-operations.service";

// Polled by the document bulk list for async operations (bulk-connect previously, exports now)
// whose progress lives in background_operations rather than an inline result.
export async function getBackgroundOperationAction(id: string) {
  requireFeature("documents");
  const ctx = await buildRequestContext();
  return getBackgroundOperation(ctx, id);
}
