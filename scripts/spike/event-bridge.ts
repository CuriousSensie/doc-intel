// Phase 0 — event bridge spike (specs/01-architecture.md §Event bridge). Stands up a throwaway
// listener to observe whether Paperless's post-consume script fires, with what payload, and how
// promptly. Not the real webhook route (that's Phase 1's document-consumed/route.ts).
import { createServer } from "node:http";

const PORT = Number(process.env.SPIKE_LISTENER_PORT ?? 4001);

const events: Array<{
  receivedAt: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> = [];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const receivedAt = new Date().toISOString();
    events.push({ receivedAt, headers: req.headers, body });
    console.log(`\n[${receivedAt}] ${req.method} ${req.url}`);
    console.log("  headers:", JSON.stringify(req.headers));
    console.log("  body:", body);
    console.log(`  total events received so far: ${events.length}`);
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "received" }));
  });
});

server.listen(PORT, () => {
  console.log(`Event bridge spike listener on http://0.0.0.0:${PORT}`);
  console.log(
    "Point infra/.env's POMOCNIK_INTERNAL_URL at this host:port temporarily (e.g. " +
      "http://host.docker.internal:" +
      PORT +
      "), restart paperless-webserver so PAPERLESS_POST_CONSUME_SCRIPT picks up the new env, " +
      "then upload a document.\n"
  );
  console.log("Steps for the full spike:");
  console.log("  1. Upload a document (UI or API) — watch for a POST here within a few seconds.");
  console.log("  2. Upload a second document, then immediately stop this listener (Ctrl+C) or");
  console.log("     `docker compose stop paperless-webserver` mid-consumption.");
  console.log("  3. Restart the listener/webserver and confirm whether the second document's");
  console.log("     event was lost (expected — the post-consume script is best-effort) and");
  console.log("     whether a manual re-check of /api/documents/?ordering=-added would have");
  console.log("     found it anyway (this is what the Phase 1 reconciliation sweep formalizes).");
  console.log("\nRecord findings in docs/spike-findings.md, then Ctrl+C to stop.\n");
});

process.on("SIGINT", () => {
  console.log(`\n${events.length} total events captured this run.`);
  server.close(() => process.exit(0));
});
