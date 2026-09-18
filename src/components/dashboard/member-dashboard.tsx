import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { AiOverviewCard } from "@/components/dashboard/ai-overview-card";
import { EasyAccess } from "@/components/dashboard/easy-access";
import { StatsTileRow, type StatTile } from "@/components/dashboard/stats-tile-row";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import {
  getAttentionDocuments,
  getMemberStats,
  getOrgStats,
  getRecentUploads
} from "@/modules/dashboard/dashboard.service";

async function MyStatsSection({
  organizationId,
  userId
}: {
  organizationId: string;
  userId: string;
}) {
  const [stats, t] = await Promise.all([
    getMemberStats(organizationId, userId),
    getTranslations("dashboard.home")
  ]);

  const tiles: StatTile[] = [
    { key: "documents", label: t("stats.documents"), value: stats.documents, href: "/dashboard/documents" },
    { key: "entities", label: t("stats.entities"), value: stats.entities, href: "/dashboard/entities" },
    { key: "connections", label: t("stats.connections"), value: stats.connections }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.myStats")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatsTileRow tiles={tiles} />
      </CardContent>
    </Card>
  );
}

function MyStatsSectionSkeleton() {
  const tiles: StatTile[] = Array.from({ length: 3 }).map((_, index) => ({
    key: `skeleton-${index}`,
    label: "",
    value: null
  }));

  return (
    <Card>
      <CardContent className="pt-6">
        <StatsTileRow tiles={tiles} />
      </CardContent>
    </Card>
  );
}

// Reduced set per temp.md §Team Member Organization Stats — no total documents/characters.
async function ReducedOrgStatsSection({ organizationId }: { organizationId: string }) {
  const [stats, t] = await Promise.all([
    getOrgStats(organizationId),
    getTranslations("dashboard.home")
  ]);

  const tiles: StatTile[] = [
    { key: "tags", label: t("stats.tags"), value: stats.tags },
    { key: "correspondents", label: t("stats.correspondents"), value: stats.correspondents },
    { key: "documentTypes", label: t("stats.documentTypes"), value: stats.documentTypes },
    { key: "entities", label: t("stats.entities"), value: stats.entities, href: "/dashboard/entities" },
    { key: "connections", label: t("stats.connections"), value: stats.connections }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.orgStats")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatsTileRow tiles={tiles} />
      </CardContent>
    </Card>
  );
}

function ReducedOrgStatsSectionSkeleton() {
  const tiles: StatTile[] = Array.from({ length: 5 }).map((_, index) => ({
    key: `skeleton-${index}`,
    label: "",
    value: null
  }));

  return (
    <Card>
      <CardContent className="pt-6">
        <StatsTileRow tiles={tiles} />
      </CardContent>
    </Card>
  );
}

async function NeedsAttentionCard({ organizationId }: { organizationId: string }) {
  const [documents, t] = await Promise.all([
    getAttentionDocuments(organizationId),
    getTranslations("dashboard.home")
  ]);

  if (documents.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("needsAttention")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {documents.map((doc) => (
          <Link
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2 hover:bg-panel-strong/40"
            href={`/dashboard/documents/${doc.id}`}
            key={doc.id}
          >
            <span className="truncate text-sm font-semibold">{doc.title}</span>
            <Badge variant="danger">{doc.status}</Badge>
          </Link>
        ))}
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
      <CardContent className="grid gap-2">
        {uploads.length === 0 ? (
          <p className="text-sm text-muted">
            {canUpload ? (
              <>
                {t("noUploadsYet")}{" "}
                <Link className="underline underline-offset-4" href="/dashboard/documents">
                  {t("uploadADocument")}
                </Link>
                .
              </>
            ) : (
              t("noDocumentsYet")
            )}
          </p>
        ) : (
          uploads.map((upload) => (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2"
              key={upload.id}
            >
              <span className="truncate text-sm font-semibold">{upload.filename}</span>
              <Badge variant="muted">{upload.status}</Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function MemberDashboard({
  organizationId,
  userId,
  canUpload
}: {
  organizationId: string;
  userId: string;
  canUpload: boolean;
}) {
  return (
    <div className="grid gap-4">
      <Suspense fallback={<MyStatsSectionSkeleton />}>
        <MyStatsSection organizationId={organizationId} userId={userId} />
      </Suspense>

      <Suspense fallback={<ReducedOrgStatsSectionSkeleton />}>
        <ReducedOrgStatsSection organizationId={organizationId} />
      </Suspense>

      <Suspense fallback={null}>
        <NeedsAttentionCard organizationId={organizationId} />
      </Suspense>

      <Suspense fallback={null}>
        <RecentUploadsCard canUpload={canUpload} organizationId={organizationId} />
      </Suspense>

      <EasyAccess />

      <AiOverviewCard />
    </div>
  );
}
