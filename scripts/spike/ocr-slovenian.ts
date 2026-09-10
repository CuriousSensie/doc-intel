/**
 * Phase 0 — Slovenian OCR spike (specs/04-level-0-foundation.md, specs/11-roadmap.md).
 *
 * Question: with PAPERLESS_OCR_LANGUAGE=slv+eng, are č/š/ž correctly recognized on real
 * scanned Slovenian invoices? This is a fidelity check a human must eyeball — mojibake and
 * character substitution are the specific failure modes named in the spec, and there's no
 * ground-truth text to diff against for a real scan. This script automates the mechanical
 * part (upload, wait for OCR, fetch extracted text, flag likely mojibake) and prints the full
 * text for manual review.
 *
 * Usage:
 *   PAPERLESS_URL=http://localhost:8010 \
 *   PAPERLESS_ADMIN_USER=admin PAPERLESS_ADMIN_PASSWORD=... \
 *   npx tsx scripts/spike/ocr-slovenian.ts ./path/to/scanned-invoices/*.pdf
 *
 * Supply real or representative Slovenian scanned invoices — a synthetic/born-digital PDF
 * does not exercise Tesseract's recognition the way a real scan does (per spec: "verify with
 * a real Slovenian scanned invoice, not a synthetic PDF").
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { login, paperlessFetch } from "./lib/paperless-admin";

// Common mojibake signatures for č/š/ž when UTF-8 text is mis-decoded as Latin-1/Windows-1252,
// or when the expected diacritic is dropped entirely — both are the failure modes the spec
// calls out explicitly.
const MOJIBAKE_PATTERNS = [/Ã¤/, /Ã¥/, /Ã¾/, /Å¡/, /Å¾/, /Ä\x8d/, /�/];
const SLOVENIAN_CHARS = /[čšžČŠŽ]/g;

async function waitForDocument(token: string, taskId: string): Promise<number | null> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await paperlessFetch(`/api/tasks/?task_id=${taskId}`, token);
    if (!res.ok) continue;
    const tasks = (await res.json()) as Array<{
      status: string;
      related_document?: number;
      result?: string;
    }>;
    const task = tasks[0];
    if (task?.status === "SUCCESS" && task.related_document) return task.related_document;
    if (task?.status === "FAILURE") {
      console.error("  consumption failed:", task.result);
      return null;
    }
  }
  return null;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    throw new Error("Usage: npx tsx scripts/spike/ocr-slovenian.ts <file1.pdf> [file2.pdf ...]");
  }

  const adminUser = process.env.PAPERLESS_ADMIN_USER;
  const adminPassword = process.env.PAPERLESS_ADMIN_PASSWORD;
  if (!adminUser || !adminPassword) {
    throw new Error("Set PAPERLESS_ADMIN_USER and PAPERLESS_ADMIN_PASSWORD");
  }
  const token = await login(adminUser, adminPassword);

  for (const filePath of files) {
    console.log(`\n=== ${basename(filePath)} ===`);
    const bytes = readFileSync(filePath);
    const form = new FormData();
    form.append("document", new Blob([bytes]), basename(filePath));
    form.append("title", basename(filePath));

    const uploadRes = await paperlessFetch("/api/documents/post_document/", token, {
      method: "POST",
      body: form
    });
    if (!uploadRes.ok) {
      console.error(`  upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
      continue;
    }
    const taskId = (await uploadRes.text()).replace(/"/g, "");
    console.log(
      `  task ${taskId} — waiting for OCR to complete (this is the slow, honest part)...`
    );

    const documentId = await waitForDocument(token, taskId);
    if (!documentId) {
      console.error("  did not complete in time — increase the poll budget or check queue depth");
      continue;
    }

    const docRes = await paperlessFetch(`/api/documents/${documentId}/`, token);
    const doc = (await docRes.json()) as { content: string };
    const content = doc.content ?? "";

    const slovenianCharCount = (content.match(SLOVENIAN_CHARS) ?? []).length;
    const mojibakeHits = MOJIBAKE_PATTERNS.filter((p) => p.test(content));

    console.log(`  document id: ${documentId}`);
    console.log(`  Slovenian diacritic characters found: ${slovenianCharCount}`);
    console.log(
      `  mojibake signatures detected: ${mojibakeHits.length > 0 ? mojibakeHits.join(", ") : "none"}`
    );
    console.log(`  --- extracted text (review manually for correctness) ---`);
    console.log(content.slice(0, 2000));
    console.log(
      content.length > 2000 ? `  ... (${content.length - 2000} more characters truncated)` : ""
    );
  }

  console.log(
    "\nRecord pass/fail per file, with specific mis-recognitions if any, in docs/spike-findings.md."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
