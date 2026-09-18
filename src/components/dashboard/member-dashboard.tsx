import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { AiOverviewCard } from "@/components/dashboard/ai-overview-card";
import { EasyAccess } from "@/components/dashboard/easy-access";
import { StatGroup, StatsList, type StatRow } from "@/components/dashboard/stats-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAttentionDocuments,
  getMemberStats,
  getOrgStats,
  getRecentUploads
} from "@/modules/dashboard/dashboard.service";

function skeletonRows(count: number): StatRow[] {
  return Array.from({ length: count }).map((_, index) => ({
    key: `skeleton-${index}`,
    label: "",
    value: null
  }));
}

async function MyStatsGroup({ organizationId, userId }: { organizationId: string; userId: string }) {
  const [stats, t] = await Promise.all([
    getMemberStats(organizationId, userId),
    getTranslations("dashboard.home")
  ]);

  const rows: StatRow[] = [
    { key: "documents", label: t("stats.documents"), value: stats.documents, href: "/dashboard/documents" },
    { key: "entities", label: t("stats.entities"), value: stats.entities, href: "/dashboard/entities" },
    { key: "connections", label: t("stats.connections"), value: stats.connections }
  ];

  return <StatGroup rows={rows} title={t("stats.myStats")} />;
}

// Reduced set per temp.md §Team Member Organization Stats — no total documents/characters.
async function ReducedOrgStatsGroup({ organizationId }: { organizationId: string }) {
  const [stats, t] = await Promise.all([
    getOrgStats(organizationId),
    getTranslations("dashboard.home")
  ]);

  const rows: StatRow[] = [
    { key: "tags", label: t("stats.tags"), value: stats.tags },
    { key: "correspondents", label: t("stats.correspondents"), value: stats.correspondents },
    { key: "documentTypes", label: t("stats.documentTypes"), value: stats.documentTypes },
    { key: "entities", label: t("stats.entities"), value: stats.entities, href: "/dashboard/entities" },
    { key: "connections", label: t("stats.connections"), value: stats.connections }
  ];

  return <StatGroup rows={rows} title={t("stats.orgStats")} />;
}

async function NeedsAttentionCard({ organizationId }: { organizationId: string }) {
  const [documents, t] = await Promise.all([
    getAttentionDocuments(organizationId),
    getTranslations("dashboard.home")
  ]);

  if (documents.length === 0) return null;

  const rows: StatRow[] = documents.map((doc) => ({
    key: doc.id,
    label: doc.title,
    value: doc.status,
    href: `/dashboard/documents/${doc.id}`,
    badgeVariant: "danger"
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("needsAttention")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatsList rows={rows} />
      </CardContent>
    </Card>
  );
}

async function RecentUploadsCard({
  organizationId,
  canUpload
}: {
  organizationId: string;
  canUpload: boolean;
}) {
  const [uploads, t] = await Promise.all([
    getRecentUploads(organizationId),
    getTranslations("dashboard.home")
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("recentUploads")}</CardTitle>
      </CardHeader>
      <CardContent>
        {uploads.length === 0 ? (
          <p className="text-sm text-muted">{canUpload ? t("noUploadsYet") : t("noDocumentsYet")}</p>
        ) : (
          <StatsList
            rows={uploads.map((upload) => ({
              key: upload.id,
              label: upload.filename,
              value: upload.status
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

export async function MemberDashboard({
  organizationId,
  userId,
  canUpload
}: {
  organizationId: string;
  userId: string;
  canUpload: boolean;
}) {
  const t = await getTranslations("dashboard.home");

  return (
    <div className="grid gap-4">
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <AiOverviewCard />

        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t("stats.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Suspense fallback={<StatGroup rows={skeletonRows(3)} title={t("stats.myStats")} />}>
              <MyStatsGroup organizationId={organizationId} userId={userId} />
            </Suspense>

            <Suspense fallback={<StatGroup rows={skeletonRows(5)} title={t("stats.orgStats")} />}>
              <ReducedOrgStatsGroup organizationId={organizationId} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <EasyAccess />

      <Suspense fallback={null}>
        <NeedsAttentionCard organizationId={organizationId} />
      </Suspense>

      <Suspense fallback={null}>
        <RecentUploadsCard canUpload={canUpload} organizationId={organizationId} />
      </Suspense>
    </div>
  );
}
