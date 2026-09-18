"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Same underline-tab style as documents/document-detail-tabs.tsx, for visual consistency across
// the two detail-page patterns in the dashboard.
const triggerClassName =
  "rounded-none border-b-2 border-transparent bg-transparent px-0.5 pb-2 pt-1 text-sm font-semibold text-muted shadow-none transition-colors data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

export function RuleDetailTabs({
  rule,
  test,
  backfill,
  runs
}: {
  rule: ReactNode;
  test: ReactNode;
  backfill: ReactNode;
  runs: ReactNode;
}) {
  const t = useTranslations("rules.detail.tabs");

  return (
    <Tabs
      className="grid gap-4 lg:h-[calc(100vh-8rem)] lg:grid-rows-[auto_minmax(0,1fr)]"
      defaultValue="rule"
    >
      <TabsList className="h-auto w-full flex-wrap justify-start gap-x-4 gap-y-1 rounded-none border-0 border-b border-border bg-transparent p-0">
        <TabsTrigger className={triggerClassName} value="rule">
          {t("rule")}
        </TabsTrigger>
        <TabsTrigger className={triggerClassName} value="test">
          {t("test")}
        </TabsTrigger>
        <TabsTrigger className={triggerClassName} value="backfill">
          {t("backfill")}
        </TabsTrigger>
        <TabsTrigger className={triggerClassName} value="runs">
          {t("runs")}
        </TabsTrigger>
      </TabsList>
      <TabsContent className="min-h-0 pt-1" value="rule">
        {rule}
      </TabsContent>
      <TabsContent className="min-h-0 overflow-hidden pt-1" value="test">
        {test}
      </TabsContent>
      <TabsContent className="min-h-0 overflow-hidden pt-1" value="backfill">
        {backfill}
      </TabsContent>
      <TabsContent className="min-h-0 overflow-hidden pt-1" value="runs">
        {runs}
      </TabsContent>
    </Tabs>
  );
}
