import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";

import { routing, type Locale } from "@/i18n/routing";
import { loadMessages } from "@/i18n/messages";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale)
  };
});
