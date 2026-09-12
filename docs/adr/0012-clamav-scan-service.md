# ADR-0012: `clamd` over TCP for the upload AV scan

## Context

`specs/10-nonfunctional.md` §Security requires "MIME sniffing (not extension trust), size cap,
extension allowlist, AV scan (ClamAV) before Paperless ingest." Nothing provisioning ClamAV
existed anywhere in the repo when `worker/jobs/validate-upload.ts` was implemented — no
container, no client dependency, no env vars. This needed a real decision, not just code: how
the worker talks to ClamAV, and what happens to an upload when the scanner itself is
unreachable.

## Decision

Run ClamAV as its own `clamd` container (`clamav/clamav:1.5.4`, `infra/docker-compose.yml`,
`full` profile only — it has no role in the Paperless-only `paperless` profile used for Phase 0
spikes) and speak its `INSTREAM` protocol directly over a raw TCP socket
(`src/lib/files/scan.ts`), rather than pulling in a client library. The protocol is a handful of
lines — a `zINSTREAM\0` command, length-prefixed chunks, a zero-length terminator, one text reply
line — and has been stable since ClamAV 0.95; the only maintained-looking npm client
(`clamdjs`) hasn't published since 2022, so a ~60-line hand-rolled client carries less
supply-chain risk than depending on it for something this small.

A scanner that's unreachable or errors is treated as a retryable infra failure
(`ScanUnavailableError`, 502 `scan_unavailable`, `src/lib/errors.ts`), not as validation failure
of the upload: `validateUpload()` lets it propagate, which flips `document_uploads.status` to
`failed` via `fail_upload_validation()` the same as any other exception in that job, and BullMQ's
existing retry policy (`worker/queues.ts`) gets another attempt. An upload is never silently
treated as clean because the scanner was down — this is the load-bearing property of putting the
scan before Paperless ingest at all.

The container's healthcheck (`clamdcheck.sh`, bundled in the official image) gets a 180s
`start_period`: ClamAV's image runs `freshclam` to pull its signature database on first boot,
which routinely takes several minutes, and a short `start_period` would make `depends_on:
clamav: { condition: service_healthy }` on the `worker` service flap on every fresh
`docker compose up`.

## Alternatives considered

- **`clamdjs` (or `clamscan`, which wraps it plus CLI-binary scanning).** Would have saved
  writing the INSTREAM framing by hand, but `clamdjs` is unmaintained (last publish 2022) and
  `clamscan` pulls in more than this needs (binary-mode scanning, config auto-detection) for a
  protocol this small and this stable. Declined; revisit if a future requirement (e.g. scanning
  very large files where backpressure/streaming matters) outgrows the hand-rolled client.
- **Treat an unreachable scanner as "scan skipped, let it through."** Would silently defeat the
  entire point of scanning before Paperless ingest — a network blip between `worker` and
  `clamav` would mean infected files reach Paperless's storage and OCR pipeline unchecked.
  Declined.
- **Block the upload pipeline indefinitely until ClamAV is reachable (no retry, no failure).**
  Would leave `document_uploads` rows stuck in `validating` forever on any transient clamd
  restart, with no path back to `failed` for `expire-abandoned-uploads.ts` (whose sweep index
  only covers `pending`/`uploaded`, not `validating`) to ever clean up. Declined in favor of
  surfacing it as a normal retryable job failure.

## Consequences

- Adds one more container to the `full` profile's boot sequence and one more thing that can be
  unhealthy; `docker compose up` for local dev now waits on `clamav`'s (slow, first-boot) health
  check before `worker` starts.
- No new runtime dependency in `package.json` — the INSTREAM client is repo-local code, testable
  and auditable without reading a third party's implementation.
- If ClamAV's protocol or this hand-rolled client ever becomes a maintenance burden (e.g. needing
  `VERSION`/`RELOAD` commands, Unix-socket support, or connection pooling under real load),
  revisit this decision rather than silently growing `scan.ts` past what a single `INSTREAM` call
  needs.
