"use client";

import {
  ArrowLeft,
  Bell,
  Building2,
  CreditCard,
  FileText,
  FolderKanban,
  History,
  LayoutDashboard,
  ListFilter,
  Lock,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Users
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useSidebar } from "@/components/layout/sidebar-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { appConfig } from "@/config/app";
import type { NavigationIcon, NavigationItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

const iconMap: Record<NavigationIcon, LucideIcon> = {
  ArrowLeft,
  Bell,
  Building2,
  CreditCard,
  FileText,
  FolderKanban,
  History,
  LayoutDashboard,
  ListFilter,
  Lock,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Users
};

const INDEX_ROUTES = new Set(["/dashboard", "/admin"]);

function isItemActive(pathname: string, href: string) {
  if (INDEX_ROUTES.has(href)) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

const LABEL_TRANSITION =
  "grid overflow-hidden transition-[grid-template-columns,opacity] duration-[350ms] ease-in-out";

function CollapsibleLabel({
  children,
  className,
  collapsed
}: {
  children: ReactNode;
  className?: string;
  collapsed: boolean;
}) {
  return (
    <span
      className={cn(
        LABEL_TRANSITION,
        collapsed ? "grid-cols-[0fr] opacity-0" : "grid-cols-[1fr] opacity-100"
      )}
    >
      <span className={cn("overflow-hidden truncate", className)}>{children}</span>
    </span>
  );
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      aria-label={appConfig.name}
      className="flex h-11 shrink-0 items-center gap-2.5 overflow-hidden px-3"
      href={"/dashboard" as Route}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-black text-background">
        {appConfig.logo.label.slice(0, 2).toUpperCase()}
      </span>
      <CollapsibleLabel className="text-sm font-bold" collapsed={collapsed}>
        {appConfig.name}
      </CollapsibleLabel>
    </Link>
  );
}

function SidebarNavLinks({ collapsed, items }: { collapsed: boolean; items: NavigationItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {items.map((item) => {
        const active = isItemActive(pathname, item.href);
        const Icon = item.icon ? iconMap[item.icon] : undefined;

        const link = (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center rounded-md px-3 text-sm font-semibold transition-[background-color,color,gap] duration-200",
              collapsed ? "justify-center gap-0 px-0" : "gap-3",
              active
                ? "bg-accent/12 text-accent"
                : "text-muted hover:bg-panel-strong hover:text-foreground"
            )}
            href={item.href as Route}
            key={item.href}
          >
            {Icon ? <Icon aria-hidden className="size-4.5 shrink-0" /> : null}
            <CollapsibleLabel collapsed={collapsed}>{item.label}</CollapsibleLabel>
          </Link>
        );

        if (!collapsed) {
          return link;
        }

        return (
          <Tooltip delayDuration={200} key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function AppSidebar({ items }: { items: NavigationItem[] }) {
  const { collapsed, toggleCollapsed } = useSidebar();

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-panel transition-[width] duration-[350ms] ease-in-out lg:flex",
          collapsed ? "w-(--sidebar-width-collapsed)" : "w-(--sidebar-width)"
        )}
      >
        <div className="flex h-(--topbar-height) shrink-0 items-center justify-between border-b border-border pl-1 pr-2">
          <SidebarBrand collapsed={collapsed} />
          <Button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(collapsed && "hidden")}
            onClick={toggleCollapsed}
            size="icon"
            variant="ghost"
          >
            <PanelLeftClose aria-hidden className="size-4" />
          </Button>
        </div>
        <SidebarNavLinks collapsed={collapsed} items={items} />
        {collapsed ? (
          <div className="flex shrink-0 justify-center border-t border-border p-2">
            <Button
              aria-label="Expand sidebar"
              onClick={toggleCollapsed}
              size="icon"
              variant="ghost"
            >
              <PanelLeftOpen aria-hidden className="size-4" />
            </Button>
          </div>
        ) : null}
      </aside>
    </TooltipProvider>
  );
}

export function MobileSidebar({ items }: { items: NavigationItem[] }) {
  const { mobileOpen, setMobileOpen } = useSidebar();

  return (
    <Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
      <SheetContent className="flex w-72 flex-col gap-0 p-0" side="left">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-(--topbar-height) shrink-0 items-center border-b border-border pl-1">
          <SidebarBrand collapsed={false} />
        </div>
        <SidebarNavLinks collapsed={false} items={items} />
      </SheetContent>
    </Sheet>
  );
}
