#!/bin/sh
# Pomočnik post-consume bridge (specs/01-architecture.md §Event bridge).
#
# Paperless-ngx 3.x calls this script with document metadata as environment variables only
# (positional args were removed in 3.0 — see docs/adr/ for the pinned version note in
# infra/docker-compose.yml). $DOCUMENT_ID is what we need; the rest of the document's data is
# fetched by our own backend once notified, via the Paperless REST API as the resolved
# tenant's service user — never trust anything else this script could pass.
#
# Hard requirements :
#   - Never block or fail Paperless's consumption on our error — always exit 0.
#   - Keep this fast; it must not do real work, only notify. The reconciliation sweep
#     (worker/jobs/reconcile-*.ts) is the source of correctness; this script is the source of
#     *latency* only.
#   - Sign body+timestamp together (see ADR discussion in the plan's audit) — a signature over
#     the body alone, with an unsigned timestamp header, is replayable with a new timestamp.

set -u

POMOCNIK_URL="${POMOCNIK_INTERNAL_URL:-http://web:3000}/api/internal/paperless/document-consumed"
SECRET="${POMOCNIK_WEBHOOK_SECRET:?POMOCNIK_WEBHOOK_SECRET must be set in the Paperless container's env}"
TIMESTAMP="$(date +%s)"
BODY="{\"paperless_document_id\": ${DOCUMENT_ID:-null}}"

# HMAC over body+timestamp concatenated, not the body alone — see
# src/app/api/internal/paperless/document-consumed/route.ts for the verifying side, which
# must concatenate identically.
SIGNATURE="$(printf '%s' "${BODY}${TIMESTAMP}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')"

curl --silent --show-error --max-time 5 \
  --request POST "${POMOCNIK_URL}" \
  --header "Content-Type: application/json" \
  --header "X-Pomocnik-Signature: ${SIGNATURE}" \
  --header "X-Pomocnik-Timestamp: ${TIMESTAMP}" \
  --data "${BODY}" \
  || true

exit 0
