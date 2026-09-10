/**
 * Phase 0 — import throughput spike (specs/06-importer.md, specs/11-roadmap.md).
 *
 * Question: bulk-POSTing ~1,000 documents directly to Paperless's REST API — what's the
 * measured wall time, CPU, and queue behaviour, and does a second "tenant" uploading
 * concurrently see degraded interactive latency? This is the empirical basis for Phase 3's
 * per-org rate limiting and "bounded outstanding submissions" requirement
 * (docs/IMPLEMENTATION_PLAN.md Phase 3) — don't guess a rate limit, measure one.
 *
 * Usage:
 *   PAPERLESS_URL=http://localhost:8010 \
 *   PAPERLESS_ADMIN_USER=admin PAPERLESS_ADMIN_PASSWORD=... \
 *   npx tsx scripts/spike/import-throughput.ts --count 1000 --concurrency 4
 *
 * Generates synthetic small text files rather than requiring 1,000 real scanned PDFs — this
 * spike measures Paperless/queue throughput and contention, not OCR fidelity (that's the
 * separate ocr-slovenian.ts spike). A single tenant runs the bulk upload; a second simulated
 * tenant polls the document list throughout and logs its own response latency, so contention
 * is visible in the same run rather than inferred after the fact.
 */
import { bootstrapTenant, login, paperlessFetch } from "./lib/paperless-admin";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? Number(args[idx + 1]) : fallback;
  };
  return { count: get("--count", 1000), concurrency: get("--concurrency", 4) };
}

async function uploadOne(token: string, index: number): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  const form = new FormData();
  form.append(
    "document",
    new Blob([`Throughput spike document #${index}\n${"x".repeat(500)}\n`], { type: "text/plain" }),
    `spike_${index}.txt`
  );
  form.append("title", `throughput_spike_${index}`);
  const res = await paperlessFetch("/api/documents/post_document/", token, {
    method: "POST",
    body: form
  });
  return { ok: res.ok, ms: Date.now() - start };
}

async function runBatch(token: string, count: number, concurrency: number) {
  let completed = 0;
  let failed = 0;
  const latencies: number[] = [];
  const start = Date.now();

  const queue = Array.from({ length: count }, (_, i) => i);

  async function worker() {
    while (queue.length > 0) {
      const i = queue.shift();
      if (i === undefined) break;
      const { ok, ms } = await uploadOne(token, i);
      latencies.push(ms);
      if (ok) completed++;
      else failed++;
      if ((completed + failed) % 100 === 0) {
        console.log(
          `  progress: ${completed + failed}/${count} (${failed} failed), elapsed ${((Date.now() - start) / 1000).toFixed(1)}s`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const totalMs = Date.now() - start;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  return { completed, failed, totalMs, p50, p95 };
}

async function pollSecondTenantLatency(
  token: string,
  stopSignal: { stop: boolean },
  samples: number[]
) {
  while (!stopSignal.stop) {
    const start = Date.now();
    await paperlessFetch("/api/documents/?page_size=25", token);
    samples.push(Date.now() - start);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const { count, concurrency } = parseArgs();
  const adminUser = process.env.PAPERLESS_ADMIN_USER;
  const adminPassword = process.env.PAPERLESS_ADMIN_PASSWORD;
  if (!adminUser || !adminPassword) {
    throw new Error("Set PAPERLESS_ADMIN_USER and PAPERLESS_ADMIN_PASSWORD");
  }

  console.log(`Import throughput spike: ${count} documents, concurrency ${concurrency}\n`);

  const adminToken = await login(adminUser, adminPassword);
  console.log("Bootstrapping tenant A (bulk uploader) and tenant B (interactive baseline)...");
  const tenantA = await bootstrapTenant(adminToken, "throughput_a");
  const tenantB = await bootstrapTenant(adminToken, "throughput_b");

  const stopSignal = { stop: false };
  const tenantBLatencies: number[] = [];
  const pollerPromise = pollSecondTenantLatency(
    tenantB.session.token,
    stopSignal,
    tenantBLatencies
  );

  console.log(
    "\nStarting bulk upload as tenant A while tenant B polls its own document list every second...\n"
  );
  const result = await runBatch(tenantA.session.token, count, concurrency);

  stopSignal.stop = true;
  await pollerPromise;

  tenantBLatencies.sort((a, b) => a - b);
  const bP50 = tenantBLatencies[Math.floor(tenantBLatencies.length * 0.5)] ?? 0;
  const bP95 = tenantBLatencies[Math.floor(tenantBLatencies.length * 0.95)] ?? 0;

  console.log("\n=== Results ===");
  console.log(`Tenant A bulk upload: ${result.completed} succeeded, ${result.failed} failed`);
  console.log(
    `  wall time: ${(result.totalMs / 1000).toFixed(1)}s (${(result.completed / (result.totalMs / 1000)).toFixed(2)} docs/sec submitted)`
  );
  console.log(`  per-request latency p50=${result.p50}ms p95=${result.p95}ms`);
  console.log(
    `\nTenant B interactive document-list latency DURING tenant A's bulk upload (${tenantBLatencies.length} samples):`
  );
  console.log(`  p50=${bP50}ms p95=${bP95}ms`);
  console.log(
    `\nCompare tenant B's p95 against the ${"< 400 ms"} target in specs/10-nonfunctional.md for ` +
      `"Document list, 25 rows" — if it's well above that, this is the empirical basis for a ` +
      "per-org outstanding-submission cap in Phase 3, not just a requests/minute limit."
  );
  console.log(
    "\nSeparately, check OCR queue depth (docker compose logs paperless-worker, or Paperless's own"
  );
  console.log(
    "task list) — submission completing fast does not mean OCR has kept up; that's the honest ETA"
  );
  console.log(
    "the Phase 3 import UI must show, per specs/06-importer.md's OCR backpressure section."
  );
  console.log("\nRecord all of this in docs/spike-findings.md.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
