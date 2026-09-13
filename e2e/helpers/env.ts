import { readFileSync } from "node:fs";
import { join } from "node:path";

// Playwright's own Node process doesn't inherit `.env` the way the `npm run dev` subprocess it
// spawns does (Next.js loads that itself) — load it once here so helpers that need
// SUPABASE_SERVICE_ROLE_KEY etc. (createConfirmedTestUser, provisionTestOrganization) work
// whether or not the shell running `playwright test` has them exported.
let loaded = false;

export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;

  let content: string;
  try {
    content = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch {
    return; // No .env file — rely on whatever's already in process.env.
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
