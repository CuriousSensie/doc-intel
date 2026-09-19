"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import type { NavigationLinkItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function SettingsTabs({ items }: { items: NavigationLinkItem[] }) {
  const pathname = usePathname();
  const t = useTranslations("common");

  return (
    <nav aria-label={t("settingsTabs.ariaLabel")} className="border-b border-border">
      <div className="flex w-full gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);

          return (
            <Link
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-4 text-sm font-semibold transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              )}
              href={item.href}
              key={item.href}
            >
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
