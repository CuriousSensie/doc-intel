# Phase 0 Spike Findings

Filled in as each spike in `scripts/spike/` is actually run against the pinned Paperless
version (`paperlessngx/paperless-ngx:3.1.3`, see `infra/docker-compose.yml`). Per
`specs/11-roadmap.md`: "Do not skip this phase. It costs a week and protects two months." A
kill-criterion actually hit is escalated per `specs/12-agent-rules.md`, not worked around.

## 1. Isolation spike (`scripts/spike/isolation.ts`)

**Status:** in progress — infra stack pulling/booting.

**Already known before running** (see
[ADR-0006](adr/0006-disable-paperless-workflow-delegation.md)): Paperless workflows have no
owner/ACL model at all, confirmed via Paperless's own GitHub discussions #10550 and #12352
(both open as of this session). Workflow delegation is disabled for the MVP regardless of what
this spike's workflow check (test #21 in the script) shows — that check runs anyway, for the
record, in case it's changed upstream.

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | B lists documents — does not include A's | 0 leaks | _pending_ |
| 3 | B fetches A's document by id | 404 | _pending_ |
| 4 | B full-text searches for A's unique string | 0 results | _pending_ |
| 5 | B lists tags/document types/correspondents/storage paths | none of A's | _pending_ |
| 6 | B lists custom field definitions | none of A's | _pending_ |
| 8 | B downloads/previews A's document by direct URL | 404 | _pending_ |
| 12 | B lists saved views | none of A's | _pending_ |
| 17 | Paperless global search as B | no A objects | _pending_ |
| 20 | Object creation without explicit permissions | impossible (code-level guard, Phase 1) | not testable here — tracked as a Phase 1 implementation requirement |
| 21 (extra) | Workflow ACL check | confirms ADR-0006 | _pending_ |

Tests 2, 7, 9–11, 13–16, 18–19 depend on Level 1/2/3 primitives (our UUID mirror, connections,
rules, imports, AI, exports) that don't exist yet — explicitly assigned to Phase 2 per
`docs/IMPLEMENTATION_PLAN.md`, not silently dropped.

## 2. Event bridge spike (`scripts/spike/event-bridge.ts`)

**Status:** not yet run.

- Does the post-consume script fire reliably? _pending_
- Payload/headers observed: _pending_
- Latency from consumption to webhook receipt: _pending_
- Recovery after killing the listener mid-consumption: _pending_

## 3. Slovenian OCR spike (`scripts/spike/ocr-slovenian.ts`)

**Status:** not yet run — needs real or representative Slovenian scanned invoice files
supplied as script arguments (see `scripts/spike/README.md`).

- č/š/ž fidelity: _pending_
- Mojibake detected: _pending_
- Overall accuracy verdict (usable / needs alternative OCR): _pending_

## 4. Import throughput spike (`scripts/spike/import-throughput.ts`)

**Status:** not yet run.

- 1,000-document wall time / throughput: _pending_
- Tenant B's interactive document-list latency during tenant A's bulk upload (p50/p95): _pending_
- Compared against the < 400ms p95 target in `specs/10-nonfunctional.md`: _pending_
- OCR queue depth observed / honest ETA implication for Phase 3: _pending_

## Overall Phase 0 verdict

_pending — fill in once all four spikes have run. If any kill-criterion in
`scripts/spike/README.md`'s table was hit, state it here explicitly and reference the
escalation, don't just note it in passing._
