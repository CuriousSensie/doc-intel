import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "sl"],
  defaultLocale: "en",
  // Explicit, not inherited from next-intl's default — every locale gets a URL prefix,
  // including English (/en/dashboard, /sl/dashboard). Chosen to match the upstream
  // Documenti's own (unset, but equivalent) behavior.
  localePrefix: "always"
});

export type Locale = (typeof routing.locales)[number];
