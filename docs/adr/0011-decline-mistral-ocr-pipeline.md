# ADR-0011: Decline a Mistral OCR/LLM document pipeline for now

## Context

Running the real Slovenian OCR spike (`scripts/spike/ocr-slovenian.ts`, `docs/spike-findings.md`
§3) against the pinned Paperless/Tesseract stack measured 5–10 seconds per document. This
prompted evaluating a genuine alternative: a prior, separate product (Pomočnik.net) does not
use Paperless at all — it sends documents to Mistral's OCR/LLM API directly and extracts
structure-preserving markdown (tables, headings, bold intact), which measured faster and richer
than Tesseract's plain-text output in that product.

Replicating that approach here is not an OCR-engine swap. It is a reversal of the document
engine underneath the whole build:

- **D1** ("Paperless-ngx is the document engine... OCR... is Paperless's responsibility") would
  no longer hold — Mistral, not Paperless, would own text extraction.
- **D5** ("AI is never invoked because a document was uploaded") would be broken structurally,
  not incidentally: if Mistral OCR is what makes a document searchable/usable at all, an AI
  provider call happens on every upload, for every tenant, unconditionally — not gated behind
  `orgs.ai_enabled` (default false) the way `specs/08-level-2-ai.md` requires for every other
  AI capability in this product.
- **The non-goals list** ("a second OCR pipeline," "a second search engine") would both be hit:
  Paperless has no supported mechanism to accept externally-extracted text in place of its own
  OCR (confirmed: `PAPERLESS_OCR_MODE=off` only extracts pre-existing embedded text via
  `pdftotext`, it does not accept injected text), so using Mistral would mean either
  pre-embedding a text layer ourselves before handing files to Paperless (functionally
  reimplementing OCRmyPDF's job) or bypassing Paperless's storage/search entirely and building
  our own tenant-isolated document store and search index on top of Mistral's output.
- **D2's isolation model** (Paperless's own per-object ACLs, continuously verified by the
  isolation test suite) would no longer apply to documents at all if they moved out of
  Paperless — isolation would need to be redesigned around our own RLS from scratch.

## Decision

Decline the Mistral OCR pipeline for now. Continue building Level 0/1 on Paperless-ngx as
locked. Mistral (or any other LLM provider) remains available strictly as the provider behind
`packages/ai/provider.ts` for Level 2's opt-in, budget-gated, human-confirmed AI capabilities —
including the vision-fallback case `specs/08-level-2-ai.md` already anticipates ("the raw file
unless the model needs vision for a scan whose OCR failed") — which requires no change to any
locked decision.

The throughput concern that prompted this evaluation is not fully retired, and isn't waved away
by this decision: it's carried forward explicitly rather than assumed away.

## Alternatives considered

- **Replace Paperless's OCR with Mistral, keep everything else.** Not actually available as an
  option — Paperless has no supported way to accept externally-extracted text, so this would
  require pre-processing every file ourselves before consumption, which is the second-OCR-
  pipeline non-goal by another name.
- **Fully adopt the Pomočnik.net architecture** (no Paperless; Mistral OCR/LLM as the document
  engine; our own document store, search, and isolation model). Has real merit — richer
  structure-preserving output, one fewer GPL-boundary compliance burden (D3 becomes moot
  entirely without Paperless), and the isolation model would move onto infrastructure (Postgres
  RLS) already proven more consistently correct in this session's own spike than Paperless's ACL
  coverage (which leaked custom field definitions — see `docs/spike-findings.md` §1, #6).
  Declined for now because: (a) it discards D1–D3 wholesale rather than amending them, which is
  a different order of decision than anything else in this build; (b) it requires reversing the
  product's current GDPR positioning — "no customer document leaves the EU perimeter for LLM
  processing until explicit opt-in" — to "every document is sent to a third-party AI vendor by
  default," which is a legal/trust decision for the product, not an engineering one, and needs
  to be made deliberately if ever, not as a performance fix; (c) ongoing per-page API cost
  (~$4–5/1000 pages) replaces free (if CPU-bound) self-hosted compute at a scale (200k+
  documents, growing) where that recurring cost is material; (d) it would discard the Phase 0/1
  work already built and tested against Paperless this session (tenant provisioning, ACL
  permission model, the isolation suite's Paperless-specific checks).
- **Do nothing, assume Tesseract is fine.** Also rejected — the concern is legitimate and
  unresolved, just not resolved by switching engines blind. See Consequences.

## Consequences

- No architecture change. Entities, connections, rules, imports (Level 1) are unaffected either
  way — they sit above the document layer regardless of which engine produces the text/document
  object, which is exactly why this decision doesn't block continuing Level 1 work.
- **The throughput question is explicitly still open**, not resolved by this ADR. The user
  confirmed eventually-consistent turnaround (minutes-to-hours, progress visible, matching
  `specs/06-importer.md`'s existing OCR-backpressure design) is acceptable — so the async design
  already in the spec is the right shape — but this session's own spike only measured 100
  synthetic tiny documents on a resource-constrained sandbox (`docs/spike-findings.md` §4), not
  real scanned PDFs on production-equivalent hardware. **A full-scale benchmark (real documents,
  a real dedicated-vCPU host, the OCR-worker container split fixed) is a required Phase 5
  load-test item, not optional**, before trusting Tesseract's throughput at real customer
  volume (`docs/IMPLEMENTATION_PLAN.md` Phase 5).
- If that benchmark later shows Tesseract genuinely can't keep up even on proper hardware, this
  ADR is the one to revisit — with real numbers instead of a 5–10s reading from a degraded dev
  sandbox — and the GDPR/cost/architecture tradeoffs above would need a deliberate product
  decision at that point, not a quiet engineering workaround.
- Mistral (or another provider) is still a live option for Level 2 — nothing here forecloses
  using it well, just not as an unconditional, non-opt-in replacement for Level 0's OCR.
