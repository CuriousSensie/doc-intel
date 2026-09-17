# Phase 0 Spike Findings

Filled in as each spike in `scripts/spike/` is actually run against the pinned Paperless
version (`paperlessngx/paperless-ngx:3.1.3`, see `infra/docker-compose.yml`). Per
`specs/11-roadmap.md`: "Do not skip this phase. It costs a week and protects two months." A
kill-criterion actually hit is escalated per `specs/12-agent-rules.md`, not worked around.

## 0. Infra setup finding: paperless-worker container split is currently broken

While standing up `infra/docker-compose.yml` to run the spikes below, the separate
`paperless-worker` container (OCR/Celery split into its own container per D4, "so it can be
relocated to a second host under load without re-architecture") crash-looped: celery beat
raised `django.core.exceptions.ImproperlyConfigured: PAPERLESS_SECRET_KEY is not set` on every
restart, **even though `docker exec ... printenv` confirmed the variable was correctly set**
inside the container. The command-override pattern this was based on
(github.com/paperless-ngx/paperless-ngx/discussions/3900) predates Paperless 3.0's "redesigned
task system" (per its release notes) and does not appear to transfer cleanly to the pinned
3.1.3 image — root cause not fully diagnosed.

**Current state:** `paperless-worker` is defined in `infra/docker-compose.yml` but not started
(moved to a disabled profile, `restart: "no"`). `paperless-webserver` runs in Paperless's
default all-in-one mode (webserver + consumer + Celery workers together, `PAPERLESS_TASK_WORKERS:
"2"`) — its normal supported configuration. All four spikes below ran/run against this
all-in-one setup successfully; the container-split gap only affects D4's "separate container
from day one" goal, not spike feasibility itself.

**Before Phase 1 relies on a separate OCR worker container:** either root-cause the celery
beat failure (check whether Paperless 3.x needs a different subcommand, e.g. excluding beat
explicitly, or a documented multi-container setup in its 3.x docs rather than the 2.x-era
community pattern), or accept all-in-one mode through Phase 1 and revisit before the import
throughput requirements in `specs/06-importer.md` actually need horizontal OCR scaling.
Tracked in `docs/IMPLEMENTATION_PLAN.md`.

## 1. Isolation spike (`scripts/spike/isolation.ts`)

**Status:** run against `paperlessngx/paperless-ngx:3.1.3` (pinned) via
`infra/docker-compose.yml`, in all-in-one mode (see §5 below for why). First real run surfaced
three findings not in the original checklist, fixed/recorded below before the checks
themselves could run meaningfully.

### Setup-blocking findings (fixed in `scripts/spike/lib/paperless-admin.ts`)

1. **`POST /api/groups/` requires a `permissions` field** — a bare `{"name": "..."}` 400s with
   `"permissions": ["This field is required."]`. Not documented anywhere in
   `specs/01-architecture.md`'s provisioning steps.
2. **The `permissions` field on groups takes bare Django codenames, not
   `app_label.codename`.** `"documents.add_tag"` 400s ("Object with codename=... does not
   exist"); `"add_tag"` works. Confirmed via `Permission.objects.filter(content_type__app_label=
   "documents")` in a Django shell against the pinned image.
3. **A fresh Paperless group has zero permissions by default**, which is a completely separate
   layer from the per-object owner/ACL permissions this spike otherwise tests. Before fixing
   this, every tenant service user got `403 Forbidden` trying to create a single tag, let alone
   upload a document. **This must be folded into `worker/jobs/provision-tenant.ts` (Phase 1)** —
   provisioning a tenant group needs an explicit Django model-permission grant (add/change/
   delete/view for tag, document, documenttype, correspondent, storagepath, customfield,
   customfieldinstance, savedview, savedviewfilterrule, note, workflow, workflowtrigger,
   workflowaction — see the `TENANT_MODEL_PERMISSIONS` list in `scripts/spike/lib/
   paperless-admin.ts` for the exact codenames found), in addition to the per-object
   `set_permissions` grant on each object it creates. `specs/01-architecture.md`'s provisioning
   steps don't mention this at all — flag as a spec gap to note when Phase 1 implements
   provisioning for real, not just a spike-script quirk.
4. **Document upload (`POST /api/documents/post_document/`) needs a real multipart body** — an
   early version of the spike helper forced `Content-Type: application/json` on every request
   including `FormData` uploads, which Paperless correctly rejected with `415 Unsupported media
   type`. Fixed by only forcing JSON when the body isn't `FormData`. Not a Paperless finding,
   but worth noting for `src/lib/paperless/client.ts` (Phase 1) — its retry/error-mapping layer
   must handle multipart uploads distinctly from JSON calls too.

### Further setup-blocking bugs found while chasing the document-dependent checks

The first upload succeeded (fixed above) but consumption appeared to never finish. Root cause
was three more bugs, all in `scripts/spike/isolation.ts`/`ocr-slovenian.ts`'s task-polling
code, not Paperless:

5. `/api/tasks/?task_id=...` returns a **paginated envelope** (`{results: [...]}`), not a bare
   array — `tasks[0]` on the object was silently `undefined` forever.
6. Task `status` is **lowercase** (`"success"`/`"failure"`), not `"SUCCESS"`/`"FAILURE"`.
7. The completed document's id is under **`related_document_ids`** (a list), not a singular
   `related_document`.
8. Once fixed, the poll still silently stalled — root cause: `TENANT_MODEL_PERMISSIONS` (finding
   #3 above) omitted `paperlesstask` permissions, so the tenant user's `GET /api/tasks/` call
   was rejected and the polling loop's `if (taskRes.ok)` guard swallowed the failure with no
   log line. Added `paperlesstask` to the permission list and a one-time error log on the first
   failed poll so this class of bug is visible immediately, not just inferred from a timeout.

None of these are Paperless bugs — all were incorrect assumptions in the spike script about the
pinned version's actual response shapes, now fixed and verified against live responses.

### Isolation results (tenant A vs tenant B, per specs/10-nonfunctional.md)

13 checks ran after all fixes above.

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | B lists documents — does not include A's | 0 leaks | **PASS** |
| 3 | B fetches A's document by id | 404 | **PASS** |
| 4 | B full-text searches for A's unique string | 0 results | **PASS** |
| 5 | B lists tags | none of A's | **PASS** |
| 5 | B lists document types | none of A's | **PASS** |
| 5 | B lists correspondents | none of A's | **PASS** |
| 5 | B lists storage paths | none of A's | **PASS** |
| 6 | B lists custom field **definitions** | none of A's | **FAIL — confirmed leak, see below** |
| 8 | B downloads A's document by direct URL | 404 | **FAIL — got 403, see below** |
| 12 | B lists saved views | none of A's | **PASS** |
| 17 | B's global search for A's unique string | 0 results | **PASS** |
| 20 | Object creation without explicit permissions | impossible (code-level guard, Phase 1) | not testable here — tracked as a Phase 1 implementation requirement |
| 21 (extra) | Workflow ACL check | confirms ADR-0006 | **CONFIRMED** — B could see A's workflow; ADR-0006 stands |

### Confirmed leak: custom field definitions (#6)

Tenant B's `GET /api/custom_fields/` included tenant A's custom field, even with `owner` and
`set_permissions` (view/change scoped to A's group only) set at creation — the same payload
shape that correctly isolated tags, document types, correspondents, storage paths, and saved
views. This is a real, version-specific limitation, not a spike-script mistake (the request
shape was verified working for five other object classes in the same run).

**Per D2's own decision procedure** ("Any class that leaks must be handled by: keeping that
object class entirely in Pomočnik and not using Paperless's version of it, or moving to
per-tenant instances, or upstreaming a fix"): Pomočnik already mirrors custom field
*definitions* in our own `custom_field_defs` table (`specs/02-data-model.md`), scoped by
`organization_id` and RLS. **Mitigation for Phase 1: the definition-editing/listing UI and any
Server Action must query `custom_field_defs` (our mirror), never call
`GET /api/custom_fields/` directly for a cross-tenant-safe list.** This contains the leak at
the boundary we already control.

**Resolved in Phase 2 (test #7, `e2e/isolation.spec.ts`): custom field *values* do not leak.**
Set a real value on tenant A's document custom field, then checked two angles as tenant B: (a)
`GET /api/documents/:id/` for A's document still 404s with the value attached, same as the
plain document-read denial; (b) filtering the document list via `custom_field_query` using A's
(leaked, per #6) custom field id and the real value returns zero results — a tenant can't use
the leaked definition id to go fishing for cross-tenant values. Both passed against the live
pinned instance. The leak is confirmed narrow: **definitions only, never values** — no
escalation needed.

### Confirmed finding: cross-tenant document download returns 403, not 404 (#8)

Tenant B's `GET /api/documents/:id/download/` for tenant A's document returned **403
Forbidden**, not 404 — the file bytes were never exposed (403 means access was correctly
denied), but per `specs/03-api.md`'s own explicit rule: *"Cross-tenant access returns 404,
never 403. A 403 confirms the resource exists and leaks information across the tenant
boundary."* Paperless's raw API doesn't follow Pomočnik's stricter existence-hiding policy —
expected, since Paperless has no concept of "tenant" at all, only object permissions.

**This is not a new requirement — it's empirical confirmation that an already-planned piece of
Phase 1 is load-bearing, not optional.** `specs/01-architecture.md`'s Paperless client contract
already states the client "maps Paperless errors to our taxonomy," and `03-api.md`'s error
table already specifies 403→404 translation for cross-tenant access. `src/lib/paperless/
errors.ts` (Phase 1) must translate a Paperless 403 into our own `NOT_FOUND` (404) for any
tenant-scoped read, not just document downloads — this spike confirms the translation is
actually necessary for real Paperless responses, not just a defensive spec requirement.

### Escalation assessment (specs/12-agent-rules.md)

Neither #6 nor #8 is escalated to a full stop. `specs/12-agent-rules.md`'s bar is "the isolation
suite fails and the fix is not obvious" — for both findings here, the fix is already the
documented path: #6 is contained by never bypassing our own `custom_field_defs` mirror (a
pattern the schema already assumes), and #8 is exactly what the client's error-mapping layer
was already specced to do. Both are recorded as **hard requirements for Phase 1's
`src/lib/paperless/` and `src/modules/entities`/`custom-fields` work**, not deferred
"nice-to-haves" — `docs/IMPLEMENTATION_PLAN.md` is updated accordingly.

Tests 2, 7, 9–11, 13–16, 18–19 depend on Level 1/2/3 primitives (our UUID mirror, connections,
rules, imports, AI, exports) that don't exist yet — explicitly assigned to Phase 2 per
`docs/IMPLEMENTATION_PLAN.md`, not silently dropped. Test 7 (custom field *values* on a
document, as opposed to the definitions tested in #6) is flagged as **high-priority for Phase
2's first pass** given #6's finding — if values also leak, unlike definitions we don't mirror
values locally and DO rely on Paperless's own per-document access control for them, which would
need immediate escalation at that point.

## 2. Event bridge spike (`scripts/spike/event-bridge.ts`)

**Status:** partially run — the script-execution mechanism is confirmed working; actual
webhook delivery to a listener could not be verified in this sandbox (see below), for a
reason specific to this dev environment, not the design.

### Setup gap found: `host.docker.internal` doesn't resolve on Linux Docker Engine

`PAPERLESS_POST_CONSUME_SCRIPT`'s target (`POMOCNIK_INTERNAL_URL`) needs to reach a listener
running on the host during local dev, before `web` is itself a container. On Linux (unlike
Docker Desktop for Mac/Windows), `host.docker.internal` doesn't resolve by default. Fixed by
adding `extra_hosts: ["host.docker.internal:host-gateway"]` to `paperless-webserver` in
`infra/docker-compose.yml` (standard fix, Docker Engine 20.10+) — confirmed resolving
afterward (`getent hosts host.docker.internal` → `172.17.0.1`).

### What's confirmed

- The post-consume script **executes reliably and exits 0**: `docker compose logs
  paperless-webserver` shows `Executing post-consume script /scripts/notify-pomocnik.sh` →
  `/scripts/notify-pomocnik.sh exited 0` → `stderr:` (empty) immediately after every
  consumption, with no delay or retry needed.
- `POMOCNIK_INTERNAL_URL` and `POMOCNIK_WEBHOOK_SECRET` are correctly present in the
  container's environment (`env_file: .env` propagates them as expected), and `curl`/`openssl`
  (the script's only dependencies) are present in the pinned Paperless image.
- **Container-to-container connectivity on the compose network works fine** — confirmed
  separately by curling `http://tika:9998/tika` from inside `paperless-webserver` (200 OK).
  This is the actual production-relevant path: in the real deployment, the webhook target is
  `http://web:3000` (another container on the same `pomocnik` network), not a host process.

### What couldn't be verified here

A direct `curl` from inside the `paperless-webserver` container to
`http://host.docker.internal:4001` (this sandbox's throwaway Node listener, running on the
host, per `scripts/spike/event-bridge.ts`) **times out** (`curl` exit 28, `curl_status=000`) —
this sandboxed environment blocks container→host-process connections at the network level
(likely a firewall/namespace restriction specific to this sandbox), separate from the DNS fix
above. Since the real Phase 1 target is container→container (`web`, not the host), **this
specific gap is not expected to reproduce in the actual infra deployment** and is not treated
as a finding against the event-bridge design — but it means the end-to-end "does a webhook
actually arrive" check, and the kill-and-recover half of this spike, are **still open** and
should be re-verified once `src/app/api/internal/paperless/document-consumed/route.ts` exists
and `web` is itself a compose service (Phase 1), where the target is a container, not the host.

- Payload/headers observed: not captured (delivery blocked before reaching the listener).
- Latency from consumption to webhook receipt: not measurable here.
- Recovery after killing the listener mid-consumption: not tested here — defer to Phase 1's
  real reconciliation sweep test (`docs/IMPLEMENTATION_PLAN.md` Phase 1 §9's isolation suite
  neighbors this; add an explicit reconciliation-recovery test alongside it).

## 3. Slovenian OCR spike (`scripts/spike/ocr-slovenian.ts`)

**Status:** confirmed against a real document, pulled directly from the live Paperless instance
(document id 105, `99.png`, a real Slovenian invoice — "RAČUN" — the user uploaded and OCR'd).
**Prose/label text: excellent fidelity.** **Tabular numeric data: a real, reproducible gap** —
see below. Per `specs/11-roadmap.md`'s kill criterion ("poor accuracy → evaluate alternative OCR
before building on it") — **not triggered** (the gap is narrow and specific, not general "poor
accuracy"), but tracked as a known limitation, not silently accepted.

- **Confirmed**: `tesseract-ocr-slv` is present in the pinned `paperlessngx/paperless-ngx:3.1.3`
  image out of the box — `docker compose logs paperless-webserver` on first boot shows
  `[init-tesseract-langs] Package tesseract-ocr-slv already installed!`, no extra install step
  needed. `PAPERLESS_OCR_LANGUAGE=slv+eng` / `PAPERLESS_OCR_LANGUAGES=slv eng` are set correctly
  in `infra/docker-compose.yml` and Paperless accepted them without error.
- **č/š/ž fidelity: confirmed excellent** — every diacritic in the source image (RAČUN,
  Številka, Šempeter, ZDRUŽ.DRŽAVE, račun, številka) round-trips correctly in the stored
  `content` field, verified by pulling `GET /api/documents/105/` directly and diffing against
  the source image line by line. No mojibake.
- **Real gap found: tabular/numeric data is dropped, not just misaligned.** The source image has
  two tables. The first (line items: quantity/price/VAT/price-with-VAT/USD value, one row:
  `1,00 | 100,00 | 0,00 (0%) | 100,00 | 100,00`) and the four-line totals block between the two
  tables (`SKUPAJ: 100,00`, `SKUPAJ USD: 100,00`, `Za plačilo USD: 100,00`, `EUR: 89,68`) are
  **entirely absent** from the extracted `content` — not garbled, just missing, as if that
  region of the image produced no text at all. The second table (VAT breakdown) fared better —
  its numbers (`0,00 % | 89,68 | 0,00 | 89,68`) did come through. This is consistent with
  Tesseract's known weakness on whitespace-delimited (no ruled lines) multi-column tables, not a
  Slovenian-language-specific issue — the same one-row table structure defeated it while running
  the DDV table with numbers already left-of-decimal (fewer columns, more numeric consistency)
  through fine.
- **Product impact**: full-text search over an invoice's own totals/line-item amounts (searching
  for "89,68" or "100,00" as they appear in the item table) will miss this document, since that
  text was never indexed — Paperless is only as searchable as what Tesseract actually extracted.
  Anything downstream that reads Paperless's OCR `content` for the same purpose (a future Level
  2 AI extraction step) inherits the same gap unless it works from the original file/image
  directly rather than the text layer.
- Overall accuracy verdict: **usable for prose/labels** (search, browsing, correspondent/date
  matching all fine); **known-incomplete for tabular monetary data** — flag as a real limitation
  when designing anything that assumes OCR text captures every number on an invoice, not
  something to silently work around by claiming "no caveats."

## 4. Import throughput spike (`scripts/spike/import-throughput.ts`)

**Status:** ran at reduced scale (100 documents, not the full 1,000) — this sandbox's disk is
constrained (see §0-adjacent Docker storage note in the session log) and, more importantly,
these are synthetic tiny text files, not real scanned PDFs, so this run measures **submission
throughput and interactive contention**, not real OCR throughput — exactly the distinction the
script's own header comment calls out. **A full 1,000-document run against real or
representative scanned PDFs, on the actual target VPS, is still required** before trusting any
throughput number for Phase 3's rate-limit design — fold into Phase 5's load test rather than
re-running here.

- 100-document wall time: 3.7s submitted (27.3 docs/sec), concurrency 4, 0 failures.
- Per-request submission latency: p50=141ms, p95=213ms.
- Tenant B's interactive document-list latency *during* tenant A's bulk upload: p50=89ms,
  p95=96ms — comfortably under the <400ms p95 target in `specs/10-nonfunctional.md`, but at
  only 100 tiny synthetic documents this isn't a meaningful stress test of that target.
- **OCR backlog confirmed real even at this trivial scale**: `redis-cli llen celery` showed 13
  queued tasks immediately after 100 submissions completed in under 4 seconds — submission
  finishing fast does not mean consumption has kept up, confirming `specs/06-importer.md`'s
  explicit warning that import "done" and OCR "done" must be tracked and surfaced separately in
  the UI. This holds even for plain text files with only `PAPERLESS_TASK_WORKERS=2` in
  all-in-one mode (§0) — a real scanned-PDF import at 1,000+ documents will show this far more
  sharply.
- Kill criterion **not evaluable at this scale** — "unacceptable contention → dedicated OCR
  workers per large tenant" requires the full-scale, real-document run this spike didn't get in
  this session.

## Overall Phase 0 verdict

**No kill criterion was hit.** Proceed to Phase 1, with the following carried forward as
concrete, tracked work rather than assumptions:

| Finding | Severity | Where it's tracked |
|---|---|---|
| Custom field definitions leak across tenants in Paperless's own `/api/custom_fields/` (isolation #6) | Real, but contained by never bypassing our own mirror | `docs/IMPLEMENTATION_PLAN.md` Phase 2 — `custom_field_defs`/entities work must query our mirror only |
| Cross-tenant document download returns 403, not 404 (isolation #8) | Real, but exactly what the spec already designed `src/lib/paperless/errors.ts` to fix | `docs/IMPLEMENTATION_PLAN.md` Phase 1 — Paperless client error mapping |
| Custom field **values** on documents (test #7) — not yet tested | Unknown, could be more serious than #6 since we don't mirror values | Flagged high-priority for Phase 2's first isolation pass |
| Fresh Paperless groups have zero Django model permissions by default; the exact codename list and format (bare `codename`, not `app_label.codename`) had to be found empirically | Would have completely blocked tenant provisioning if undiscovered until Phase 1 | `docs/IMPLEMENTATION_PLAN.md` Phase 1 — `worker/jobs/provision-tenant.ts` must grant `TENANT_MODEL_PERMISSIONS` (see `scripts/spike/lib/paperless-admin.ts`) alongside per-object ACLs |
| Separate `paperless-worker` OCR container crash-loops on the pinned 3.1.3 image; running in all-in-one mode instead | Real gap against D4's "separate container from day one," not a blocker for Phase 1 functionality | `docs/IMPLEMENTATION_PLAN.md` — root-cause before Phase 3/5 needs real horizontal OCR scaling |
| `host.docker.internal` needs explicit `extra_hosts` on Linux; container→host connectivity is further blocked in this specific sandbox (container→container is fine) | Dev-environment-only; the real Phase 1 target is container→container | Fixed in `infra/docker-compose.yml`; re-verify full webhook delivery once `web` is a compose service |
| Event bridge script execution, env propagation, and container-to-container networking are all confirmed working; end-to-end webhook delivery and kill-and-recover are still unverified | Open, not failed | Re-run once `src/app/api/internal/paperless/document-consumed/route.ts` exists |
| Slovenian OCR fidelity on a real scan | **Resolved with a caveat** — prose/labels excellent (č/š/ž verified correct, no mojibake), but tabular numeric data (line items, totals) is dropped entirely on the one real invoice tested, verified directly against `GET /api/documents/105/` | Kill criterion not triggered; the tabular-data gap is a known limitation for anything relying on OCR text to capture every number on an invoice — see §3 |
| Import throughput at real scale (1,000 real scanned documents) | Only a 100-document synthetic-file proxy run this session | Fold into Phase 5's load test on the actual target VPS |

**What this session's spike work actually proved beyond the checklist**: every setup-blocking
bug found (permission codenames and format, task-polling response shape, multipart
content-type, `host.docker.internal` resolution) would otherwise have been discovered for the
first time while building Phase 1's real provisioning/upload/webhook code — surfacing them now,
against throwaway spike scripts, is exactly what Phase 0 is for. The two data-isolation
findings (#6, #8) both have obvious, already-anticipated mitigations in the existing spec and
plan, which is why neither triggers an escalation per `specs/12-agent-rules.md`'s "fix is not
obvious" bar — but both are now *proven* requirements, not just specced ones.
