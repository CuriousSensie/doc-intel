import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { AiOverviewCard } from "@/components/dashboard/ai-overview-card";
import { EasyAccess } from "@/components/dashboard/easy-access";
import { MemberPicker } from "@/components/dashboard/member-picker";
import { StatsTileRow, type StatTile } from "@/components/dashboard/stats-tile-row";
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

async function OrgStatsSection({ organizationId }: { organizationId: string }) {
  const [stats, t] = await Promise.all([
    getOrgStats(organizationId),
    getTranslations("dashboard.home")
  ]);

  const tiles: StatTile[] = [
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

function OrgStatsSectionSkeleton() {
  const tiles: StatTile[] = Array.from({ length: 7 }).map((_, index) => ({
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

async function MemberStatsSection({
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

  const tiles: StatTile[] = [
    { key: "documents", label: t("stats.documents"), value: stats.documents, href: "/dashboard/documents" },
    { key: "entities", label: t("stats.entities"), value: stats.entities, href: "/dashboard/entities" },
    { key: "connections", label: t("stats.connections"), value: stats.connections }
  ];

  return <StatsTileRow tiles={tiles} />;
}

function MemberStatsSectionSkeleton() {
  const tiles: StatTile[] = Array.from({ length: 3 }).map((_, index) => ({
    key: `skeleton-${index}`,
    label: "",
    value: null
  }));

  return <StatsTileRow tiles={tiles} />;
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
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2">
          <span className="text-sm text-muted">{t("pendingInvites")}</span>
          <span className="text-lg font-black">{count}</span>
        </div>
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
  const selectedMember = members.find((member) => member.user_id === memberId);
  const memberLabel = selectedMember?.profile?.name || selectedMember?.profile?.email || "";

  return (
    <div className="grid gap-4">
      <Suspense fallback={null}>
        <ProvisioningBanner organizationId={organizationId} />
      </Suspense>

      {isFeatureEnabled("documents") ? (
        <Suspense fallback={<OrgStatsSectionSkeleton />}>
          <OrgStatsSection organizationId={organizationId} />
        </Suspense>
      ) : null}

      <Card>
        <CardHeader className="flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("stats.memberStats", { name: memberLabel })}</CardTitle>
          {members.length > 0 ? (
            <MemberPicker members={members} selectedMemberId={memberId} />
          ) : null}
        </CardHeader>
        <CardContent>
          <Suspense fallback={<MemberStatsSectionSkeleton />} key={memberId}>
            <MemberStatsSection memberId={memberId} organizationId={organizationId} />
          </Suspense>
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        <PendingInvitesCard organizationId={organizationId} />
      </Suspense>

      <EasyAccess />

      <AiOverviewCard />
    </div>
  );
}
