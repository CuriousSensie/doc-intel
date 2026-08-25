"use client";

import { LogOut, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
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

  return (
    <>
      <form action={logoutAction} className="hidden" ref={logoutFormRef} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Open account menu"
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
            <Link href={settingsHref as Route}>
              <Settings aria-hidden className="size-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          {isAdmin ? (
            <DropdownMenuItem asChild>
              <Link href={"/admin" as Route}>
                <ShieldCheck aria-hidden className="size-4" />
                Admin
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
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
