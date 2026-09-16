"use client";

import { Bell, Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ReactNode } from "react";

import { useSidebar } from "@/components/layout/sidebar-provider";
import { NavUserMenu } from "@/components/layout/nav-user-menu";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

export function AppTopbar({
  isAdmin = false,
  notificationsHref,
  organizationSwitcher,
  settingsHref,
  title,
  unreadCount = 0,
  user
}: {
  isAdmin?: boolean;
  notificationsHref?: string;
  organizationSwitcher?: ReactNode;
  settingsHref?: string;
  title?: ReactNode;
  unreadCount?: number;
  user: { name: string; email: string; avatarUrl?: string | null };
}) {
  const { setMobileOpen } = useSidebar();
  const t = useTranslations("common.topbar");

  return (
    <header className="sticky top-0 z-30 flex h-(--topbar-height) shrink-0 items-center gap-1 border-b border-border bg-panel/95 px-2 backdrop-blur supports-backdrop-filter:bg-panel/75 sm:gap-3 sm:px-6">
      <Button
        aria-label={t("openNavigation")}
        className="lg:hidden"
        onClick={() => setMobileOpen(true)}
        size="icon"
        variant="ghost"
      >
        <Menu aria-hidden className="size-5" />
      </Button>

      <div className="hidden min-w-0 flex-1 sm:block">
        {title ? (
          <div className="hidden truncate text-sm font-bold sm:block sm:text-base">{title}</div>
        ) : null}
      </div>

      {organizationSwitcher ? (
        <div className="min-w-0 flex-1 sm:max-w-60 sm:flex-initial">{organizationSwitcher}</div>
      ) : null}

      {notificationsHref ? (
        <Button aria-label={t("notifications")} asChild size="icon" variant="ghost">
          <Link className="relative" href={notificationsHref}>
            <Bell aria-hidden className="size-4.5" />
            {unreadCount > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1.5 top-1.5 flex size-2 rounded-full bg-accent",
                  "ring-2 ring-panel"
                )}
              />
            ) : null}
            <span className="sr-only">
              {unreadCount > 0
                ? t("unreadNotifications", { count: unreadCount })
                : t("notifications")}
            </span>
          </Link>
        </Button>
      ) : null}

      <LocaleSwitcher />
      <ThemeToggle />

      <NavUserMenu isAdmin={isAdmin} settingsHref={settingsHref} user={user} />
    </header>
  );
}
