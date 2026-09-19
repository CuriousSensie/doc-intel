#!/bin/sh
# Documenti post-consume bridge. Paperless 3.x passes metadata as env vars only (no positional
# args since 3.0). $DOCUMENT_ID is all we need — the rest is fetched via the Paperless API once
# notified, as the resolved tenant.
#
# Must never block/fail consumption on our error (always exit 0) and must stay fast — the
# reconciliation sweep is the source of correctness, this script is only the source of latency.
# Signs body+timestamp together, not the body alone — an unsigned timestamp is replayable.

set -u

DOCUMENTI_URL="${DOCUMENTI_INTERNAL_URL:-http://web:3000}/api/internal/paperless/document-consumed"
SECRET="${DOCUMENTI_WEBHOOK_SECRET:?DOCUMENTI_WEBHOOK_SECRET must be set in the Paperless container's env}"
TIMESTAMP="$(date +%s)"
BODY="{\"paperless_document_id\": ${DOCUMENT_ID:-null}}"

SIGNATURE="$(printf '%s' "${BODY}${TIMESTAMP}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')"

curl --silent --show-error --max-time 5 \
  --request POST "${DOCUMENTI_URL}" \
  --header "Content-Type: application/json" \
  --header "X-Documenti-Signature: ${SIGNATURE}" \
  --header "X-Documenti-Timestamp: ${TIMESTAMP}" \
  --data "${BODY}" \
  || true

exit 0
