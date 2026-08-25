"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

import type { NavigationItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function SettingsTabs({ items }: { items: NavigationItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="border-b border-border">
      <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto">
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
              href={item.href as Route}
              key={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
