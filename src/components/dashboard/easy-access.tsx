"use client";

import { History, LayoutList } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentActivity } from "@/hooks/use-recent-activity";
import type { RecentItem } from "@/lib/dashboard/recent-activity";

function RecentList({ items }: { items: RecentItem[] }) {
  return (
    <div className="grid content-start gap-2">
      {items.map((item) => (
        <Link
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2 hover:bg-panel-strong/40"
          href={item.href}
          key={item.id}
        >
          <span className="truncate text-sm font-semibold">{item.label}</span>
        </Link>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton className="h-10 rounded-md" key={index} />
      ))}
    </div>
  );
}

// Recently accessed documents / most-used views — per-browser, localStorage-backed (see
// src/lib/dashboard/recent-activity.ts). Shared between the Owner and Team Member dashboards;
// each viewer only ever sees their own device's history, so no organizationId prop is needed.
export function EasyAccess() {
  const t = useTranslations("dashboard.home");
  const { documents, views, isLoading } = useRecentActivity();
  const isEmpty = !isLoading && documents.length === 0 && views.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("easyAccess")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <EmptyState
            description={t("noRecentActivityDescription")}
            icon={History}
            title={t("noRecentActivity")}
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-2">
              <h3 className="text-sm font-semibold text-muted">{t("recentDocuments")}</h3>
              {isLoading ? (
                <ListSkeleton />
              ) : documents.length === 0 ? (
                <EmptyState icon={LayoutList} title={t("noRecentDocuments")} />
              ) : (
                <RecentList items={documents} />
              )}
            </div>
            <div className="grid content-start gap-2">
              <h3 className="text-sm font-semibold text-muted">{t("recentViews")}</h3>
              {isLoading ? (
                <ListSkeleton />
              ) : views.length === 0 ? (
                <EmptyState icon={LayoutList} title={t("noRecentViews")} />
              ) : (
                <RecentList items={views} />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
