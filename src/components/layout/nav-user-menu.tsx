"use client";

import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRef } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/modules/auth/auth.actions";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "U";
}

export function NavUserMenu({
  isAdmin = false,
  settingsHref = "/settings/profile",
  user
}: {
  isAdmin?: boolean;
  settingsHref?: string;
  user: { name: string; email: string; avatarUrl?: string | null };
}) {
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const t = useTranslations("common.navUserMenu");

  return (
    <>
      <form action={logoutAction} className="hidden" ref={logoutFormRef} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t("openAccountMenu")}
            className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            type="button"
          >
            <Avatar>
              <AvatarImage alt="" src={user.avatarUrl ?? undefined} />
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5 normal-case tracking-normal">
            <span className="truncate text-sm font-semibold text-foreground">{user.name}</span>
            <span className="truncate text-xs font-normal text-muted">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={settingsHref}>
              <Settings aria-hidden className="size-4" />
              {t("settings")}
            </Link>
          </DropdownMenuItem>
          {isAdmin ? (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <ShieldCheck aria-hidden className="size-4" />
                {t("admin")}
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-danger data-highlighted:bg-danger/10 data-highlighted:text-danger"
            onSelect={(event) => {
              event.preventDefault();
              logoutFormRef.current?.requestSubmit();
            }}
          >
            <LogOut aria-hidden className="size-4" />
            {t("logOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
