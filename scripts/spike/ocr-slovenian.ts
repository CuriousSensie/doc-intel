// Phase 0 — Slovenian OCR spike. Uploads real scanned invoices, waits for OCR, flags likely
// mojibake, and prints extracted text for manual č/š/ž review (no ground truth to diff against).
// Usage: PAPERLESS_URL=... PAPERLESS_ADMIN_USER=... PAPERLESS_ADMIN_PASSWORD=... npx tsx scripts/spike/ocr-slovenian.ts <files...>
// Use real scans, not synthetic PDFs — Tesseract's recognition path differs.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { login, paperlessFetch } from "./lib/paperless-admin";

// č/š/ž mis-decoded as Latin-1/Windows-1252, or dropped entirely.
const MOJIBAKE_PATTERNS = [/Ã¤/, /Ã¥/, /Ã¾/, /Å¡/, /Å¾/, /Ä\x8d/, /�/];
const SLOVENIAN_CHARS = /[čšžČŠŽ]/g;

async function waitForDocument(token: string, taskId: string): Promise<number | null> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await paperlessFetch(`/api/tasks/?task_id=${taskId}`, token);
    if (!res.ok) {
      if (i === 0) console.error(`  task poll returned ${res.status}: ${await res.text()}`);
      continue;
    }
    // Paginated envelope, lowercase status, related_document_ids as a list (see isolation.ts).
    const body = (await res.json()) as {
      results: Array<{ status: string; related_document_ids?: number[]; result?: string }>;
    };
    const task = body.results[0];
    if (task?.status === "success" && task.related_document_ids?.[0])
      return task.related_document_ids[0];
    if (task?.status === "failure") {
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
