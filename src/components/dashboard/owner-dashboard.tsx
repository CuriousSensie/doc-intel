import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { AiOverviewCard } from "@/components/dashboard/ai-overview-card";
import { EasyAccess } from "@/components/dashboard/easy-access";
import { MemberPicker } from "@/components/dashboard/member-picker";
import { StatGroup, StatsList, type StatRow } from "@/components/dashboard/stats-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isFeatureEnabled } from "@/config/features";
import {
  getMemberStats,
  getOrgStats,
  getPendingInvitesCount,
  getProvisioningStatus
} from "@/modules/dashboard/dashboard.service";
import { listMembers } from "@/modules/organizations/organizations.service";

async function ProvisioningBanner({ organizationId }: { organizationId: string }) {
  const [status, t] = await Promise.all([
    getProvisioningStatus(organizationId),
    getTranslations("dashboard.home")
  ]);

  if (status === "ready") return null;

  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
      {t("provisioningStatus")} <Badge variant="muted">{status}</Badge>
    </div>
  );
}

async function OrgStatsGroup({ organizationId }: { organizationId: string }) {
  const [stats, t] = await Promise.all([
    getOrgStats(organizationId),
    getTranslations("dashboard.home")
  ]);

  const rows: StatRow[] = [
    { key: "documents", label: t("stats.documents"), value: stats.documents, href: "/dashboard/documents" },
    {
      key: "noConnections",
      label: t("stats.noConnections"),
      value: stats.noConnections,
      href: "/dashboard/documents?hasNoConnections=true"
    },
    { key: "entities", label: t("stats.entities"), value: stats.entities, href: "/dashboard/entities" },
    { key: "connections", label: t("stats.connections"), value: stats.connections },
    { key: "tags", label: t("stats.tags"), value: stats.tags },
    { key: "correspondents", label: t("stats.correspondents"), value: stats.correspondents },
    { key: "documentTypes", label: t("stats.documentTypes"), value: stats.documentTypes }
  ];

  return <StatGroup rows={rows} title={t("stats.orgStats")} />;
}

function skeletonRows(count: number): StatRow[] {
  return Array.from({ length: count }).map((_, index) => ({
    key: `skeleton-${index}`,
    label: "",
    value: null
  }));
}

// Rows only (no repeated group title) — the parent already renders the "Member stats" heading
// alongside the picker (which itself shows the selected member's name), and the Suspense
// fallback needs to sit under that same fixed heading.
async function MemberStatsRows({
  organizationId,
  memberId
}: {
  organizationId: string;
  memberId: string;
}) {
  const [stats, t] = await Promise.all([
    getMemberStats(organizationId, memberId),
    getTranslations("dashboard.home")
  ]);

  const rows: StatRow[] = [
    { key: "documents", label: t("stats.documents"), value: stats.documents, href: "/dashboard/documents" },
    { key: "entities", label: t("stats.entities"), value: stats.entities, href: "/dashboard/entities" },
    { key: "connections", label: t("stats.connections"), value: stats.connections }
  ];

  return <StatsList rows={rows} />;
}

async function PendingInvitesCard({ organizationId }: { organizationId: string }) {
  const [count, t] = await Promise.all([
    getPendingInvitesCount(organizationId),
    getTranslations("dashboard.home")
  ]);

  if (count === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("team")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatsList
          rows={[{ key: "pendingInvites", label: t("pendingInvites"), value: count, href: "/settings/team" }]}
        />
      </CardContent>
    </Card>
  );
}

export async function OwnerDashboard({
  organizationId,
  userId,
  selectedMemberId
}: {
  organizationId: string;
  userId: string;
  selectedMemberId?: string;
}) {
  const [members, t] = await Promise.all([
    listMembers(organizationId),
    getTranslations("dashboard.home")
  ]);
  const memberId =
    selectedMemberId && members.some((member) => member.user_id === selectedMemberId)
      ? selectedMemberId
      : userId;

  return (
    <div className="grid gap-4">
      <Suspense fallback={null}>
        <ProvisioningBanner organizationId={organizationId} />
      </Suspense>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <AiOverviewCard />

        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t("stats.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {isFeatureEnabled("documents") ? (
              <Suspense fallback={<StatGroup rows={skeletonRows(7)} title={t("stats.orgStats")} />}>
                <OrgStatsGroup organizationId={organizationId} />
              </Suspense>
            ) : null}

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("stats.memberStats")}
                </h3>
                {members.length > 0 ? (
                  <MemberPicker members={members} selectedMemberId={memberId} />
                ) : null}
              </div>
              <Suspense fallback={<StatsList rows={skeletonRows(3)} />} key={memberId}>
                <MemberStatsRows memberId={memberId} organizationId={organizationId} />
              </Suspense>
            </div>
          </CardContent>
        </Card>
      </div>

      <EasyAccess />

      <Suspense fallback={null}>
        <PendingInvitesCard organizationId={organizationId} />
      </Suspense>
    </div>
  );
}
