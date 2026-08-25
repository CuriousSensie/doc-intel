"use client";

import { Bell, Menu } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { useSidebar } from "@/components/layout/sidebar-provider";
import { NavUserMenu } from "@/components/layout/nav-user-menu";
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

  return (
    <header className="sticky top-0 z-30 flex h-(--topbar-height) shrink-0 items-center gap-3 border-b border-border bg-panel/95 px-4 backdrop-blur supports-backdrop-filter:bg-panel/75 sm:px-6">
      <Button
        aria-label="Open navigation"
        className="lg:hidden"
        onClick={() => setMobileOpen(true)}
        size="icon"
        variant="ghost"
      >
        <Menu aria-hidden className="size-5" />
      </Button>

      <div className="min-w-0 flex-1">
        {title ? (
          <div className="hidden truncate text-sm font-bold sm:block sm:text-base">{title}</div>
        ) : null}
      </div>

      {organizationSwitcher ? (
        <div className="max-w-28 shrink sm:max-w-none">{organizationSwitcher}</div>
      ) : null}

      {notificationsHref ? (
        <Button aria-label="Notifications" asChild size="icon" variant="ghost">
          <Link className="relative" href={notificationsHref as Route}>
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
              {unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
            </span>
          </Link>
        </Button>
      ) : null}

      <ThemeToggle />

      <NavUserMenu isAdmin={isAdmin} settingsHref={settingsHref} user={user} />
    </header>
  );
}
