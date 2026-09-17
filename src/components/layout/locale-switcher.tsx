"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { routing, type Locale } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";

const localeLabels: Record<Locale, string> = {
  en: "English",
  sl: "Slovenščina"
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("common.localeSwitcher");

  function onChange(nextLocale: string) {
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale as Locale });
    });
  }

  return (
    <Select disabled={isPending} onValueChange={onChange} value={locale}>
      <SelectTrigger
        aria-label={t("label")}
        className="w-auto min-w-16 gap-1 px-2 sm:min-w-28 sm:gap-2 sm:px-3"
      >
        <SelectValue>
          <span className="sm:hidden">{locale.toUpperCase()}</span>
          <span className="hidden sm:inline">{localeLabels[locale]}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {routing.locales.map((value) => (
          <SelectItem key={value} value={value}>
            {localeLabels[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
