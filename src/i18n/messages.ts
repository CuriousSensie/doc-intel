import type { Locale } from "@/i18n/routing";

const namespaces = [
  "common",
  "marketing",
  "auth",
  "onboarding",
  "dashboard",
  "organizations",
  "settings",
  "admin",
  "billing",
  "emails",
  // Dokumenti Level 1 — not part of the upstream Dokumenti.
  "documents",
  "entities",
  "entityTypes",
  "connections",
  "savedViews",
  "imports",
  "rules",
  "folders"
] as const;

export async function loadMessages(locale: Locale) {
  const modules = await Promise.all(
    namespaces.map((namespace) => import(`../../messages/${locale}/${namespace}.json`))
  );

  return Object.fromEntries(
    namespaces.map((namespace, index) => [namespace, modules[index].default])
  );
}
