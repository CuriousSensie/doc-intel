import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireEnv } from "@/lib/env";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { resolveTenantForPaperlessDocument } from "@/lib/paperless/client";
import { verifyPaperlessWebhookSignature } from "@/lib/paperless/webhook-signature";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ paperless_document_id: z.number().int().positive().nullable() });

/**
 * specs/01-architecture.md §Event bridge's primary path: infra/scripts/notify-dokumenti.sh POSTs
 * here from Paperless's post-consume hook, HMAC-signed over body+timestamp
 * (verifyPaperlessWebhookSignature). "Resolve the owning tenant... then continue as that
 * tenant... Enqueue a job. Do not do work in the request handler" — this handler's only real
 * job is: verify, dedupe, resolve org, enqueue sync-paperless-document.ts.
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-dokumenti-signature");
    const timestamp = request.headers.get("x-dokumenti-timestamp");

    if (!signature || !timestamp) {
      throw new AuthenticationError("Missing webhook signature headers");
    }

    const valid = verifyPaperlessWebhookSignature(
      body,
      timestamp,
      signature,
      requireEnv("DOKUMENTI_WEBHOOK_SECRET")
    );
    if (!valid) {
      throw new AuthenticationError("Invalid or stale webhook signature");
    }

    const parsed = bodySchema.safeParse(JSON.parse(body || "{}"));
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
    }

    const paperlessDocumentId = parsed.data.paperless_document_id;
    if (paperlessDocumentId == null) {
      // notify-dokumenti.sh sends `paperless_document_id: null` when Paperless didn't pass
      // $DOCUMENT_ID — a validly-signed request with nothing to act on, not an error.
      return NextResponse.json({ received: true });
    }

    const admin = createAdminClient();

    // Dedup/replay: reuse the generic webhook_events table (provider='paperless'), keyed by the
    // signature itself — notify-dokumenti.sh has no event id of its own to give us, and the
    // signature is already a deterministic, unique-per-request value within the timestamp
    // tolerance window. Same pattern as src/app/api/webhooks/stripe/route.ts.
    const { data: existing } = await admin
      .from("webhook_events")
      .select("status")
      .eq("provider", "paperless")
      .eq("event_id", signature)
      .maybeSingle();

    if (existing?.status === "processed") {
      return NextResponse.json({ received: true, deduped: true });
    }

    if (!existing) {
      const { error: insertError } = await admin.from("webhook_events").insert({
        provider: "paperless",
        event_id: signature,
        event_type: "document.consumed",
        status: "pending",
        payload: { paperless_document_id: paperlessDocumentId }
      });
      if (insertError && insertError.code !== "23505") {
        logger.error("paperless.webhook.record_failed", {
          paperlessDocumentId,
          errorMessage: insertError.message
        });
        return NextResponse.json({ error: "Failed to record webhook event" }, { status: 500 });
      }
    }

    // The webhook body carries no org info — resolve via paperless_object_map. Unresolvable (a
    // document Dokumenti hasn't synced yet) is not an error: the reconciliation sweep
    // (specs/01-architecture.md §Event bridge, not yet built) is this path's designed backstop,
    // so skip enqueueing rather than guessing a tenant.
    const orgId = await resolveTenantForPaperlessDocument(paperlessDocumentId);

    if (!orgId) {
      logger.warn("paperless.webhook.unresolved_tenant", { paperlessDocumentId });
      await admin
        .from("webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("provider", "paperless")
        .eq("event_id", signature);
      return NextResponse.json({ received: true, resolved: false });
    }

    await enqueue(QUEUE_NAMES.syncPaperlessDocument, { orgId, paperlessDocumentId });

    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("provider", "paperless")
      .eq("event_id", signature);

    return NextResponse.json({ received: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
