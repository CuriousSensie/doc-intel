"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Tab selection is plain client state, not URL-synced — the ctx/cursor/sort querystring on this
// page already carries the "which filtered list did I arrive from" state; adding tab state to
// the same URL would conflict with next/prev's own query-param usage for little real benefit.
export function DocumentDetailTabs({
  details,
  content,
  connections,
  history,
  permissions
}: {
  details: ReactNode;
  content: ReactNode;
  connections: ReactNode;
  history: ReactNode;
  permissions: ReactNode;
}) {
  const t = useTranslations("documents.detail.tabs");

  // Plain underlined headings, not the pill/pressed-button style — that version had a fixed
  // h-10 single-row bar with no wrap, so "Permissions" ran off the edge of the card at narrow
  // widths. This wraps onto a second line instead of overflowing, and an underline (rather than
  // a background pill) marks the active tab, matching how the rest of the request asked for
  // width-driven wrapping rather than horizontal scroll/clipping.
  const triggerClassName =
    "rounded-none border-b-2 border-transparent bg-transparent px-0.5 pb-2 pt-1 text-sm font-semibold text-muted shadow-none transition-colors data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

  return (
    <Tabs className="flex h-full min-h-0 flex-col" defaultValue="details">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-x-4 gap-y-1 rounded-none border-0 border-b border-border bg-transparent p-0 shrink-0">
        <TabsTrigger className={triggerClassName} value="details">
          {t("details")}
        </TabsTrigger>
        <TabsTrigger className={triggerClassName} value="content">
          {t("content")}
        </TabsTrigger>
        <TabsTrigger className={triggerClassName} value="connections">
          {t("connections")}
        </TabsTrigger>
        <TabsTrigger className={triggerClassName} value="history">
          {t("history")}
        </TabsTrigger>
        <TabsTrigger className={triggerClassName} value="permissions">
          {t("permissions")}
        </TabsTrigger>
      </TabsList>
      {/* Each panel scrolls independently within the fixed-height split (lg+) — the page itself
          doesn't scroll there; on smaller screens min-h-0 is a no-op and the page scrolls
          normally since the shell only fixes height at lg+. */}
      <TabsContent className="min-h-0 flex-1 overflow-y-auto" value="details">
        {details}
      </TabsContent>
      <TabsContent className="min-h-0 flex-1 overflow-y-auto" value="content">
        {content}
      </TabsContent>
      <TabsContent className="min-h-0 flex-1 overflow-y-auto" value="connections">
        {connections}
      </TabsContent>
      <TabsContent className="min-h-0 flex-1 overflow-y-auto" value="history">
        {history}
      </TabsContent>
      <TabsContent className="min-h-0 flex-1 overflow-y-auto" value="permissions">
        {permissions}
      </TabsContent>
    </Tabs>
  );
}
