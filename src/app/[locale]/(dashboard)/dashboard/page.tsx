import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isFeatureEnabled } from "@/config/features";
import { getOwnerAdminSummary, getMemberSummary } from "@/modules/dashboard/dashboard.service";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

function StatRow({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const content = (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-lg font-black">{value}</span>
    </div>
  );
  return href ? (
    <Link className="transition-opacity hover:opacity-80" href={href}>
      {content}
    </Link>
  ) : (
    content
  );
}

async function OwnerAdminHome({ organizationId }: { organizationId: string }) {
  const [summary, t] = await Promise.all([
    getOwnerAdminSummary(organizationId),
    getTranslations("dashboard.home")
  ]);
  const documents = isFeatureEnabled("documents");
  const entities = isFeatureEnabled("entities");

  return (
    <div className="grid gap-4">
      {summary.provisioningStatus !== "ready" ? (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
          {t("provisioningStatus")} <Badge variant="muted">{summary.provisioningStatus}</Badge>
        </div>
      ) : null}

      {documents ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("documents")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <StatRow
              href="/dashboard/documents"
              label={t("ready")}
              value={summary.documentCountsByStatus.ready ?? 0}
            />
            <StatRow
              href="/dashboard/documents"
              label={t("processing")}
              value={
                (summary.documentCountsByStatus.pending ?? 0) +
                (summary.documentCountsByStatus.processing ?? 0)
              }
            />
            <StatRow
              href="/dashboard/documents"
              label={t("failed")}
              value={summary.documentCountsByStatus.failed ?? 0}
            />
            <StatRow
              href="/dashboard/documents?hasNoConnections=true"
              label={t("noConnections")}
              value={summary.noConnectionsCount}
            />
          </CardContent>
        </Card>
      ) : null}

      {entities && summary.entityCounts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("entities")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {summary.entityCounts.map((type) => (
              <StatRow
                href={`/dashboard/entities/${type.typeKey}`}
                key={type.typeKey}
                label={type.typeName}
                value={type.count}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {summary.pendingInvitesCount > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("team")}</CardTitle>
          </CardHeader>
          <CardContent>
            <StatRow
              href="/settings/team"
              label={t("pendingInvites")}
              value={summary.pendingInvitesCount}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

async function MemberHome({
  organizationId,
  canUpload
}: {
  organizationId: string;
  canUpload: boolean;
}) {
  const [summary, t] = await Promise.all([
    getMemberSummary(organizationId),
    getTranslations("dashboard.home")
  ]);

  return (
    <div className="grid gap-4">
      {summary.attentionDocuments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("needsAttention")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {summary.attentionDocuments.map((doc) => (
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
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("recentUploads")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {summary.recentUploads.length === 0 ? (
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
            summary.recentUploads.map((upload) => (
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
    </div>
  );
}

export default async function DashboardPage() {
  const { profile, user } = await requireUser("/dashboard");
  const t = await getTranslations("dashboard.home");
  const organizationId = isFeatureEnabled("organizations")
    ? await getActiveOrganizationId(user.id)
    : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div>
        <h1 className="text-3xl font-black">
          {profile?.name ? t("welcomeBackWithName", { name: profile.name }) : t("welcomeBack")}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t("signedInAs", { name: profile?.name ?? user.email ?? "" })}
        </p>
      </div>

      {organizationId ? (
        <RoleGatedHome organizationId={organizationId} userId={user.id} />
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted">
          {t("notInOrganization")}
        </p>
      )}
    </div>
  );
}

async function RoleGatedHome({
  organizationId,
  userId
}: {
  organizationId: string;
  userId: string;
}) {
  const membership = await getMembership(organizationId, userId);
  const role = membership?.role;

  if (role === "owner" || role === "admin") {
    return <OwnerAdminHome organizationId={organizationId} />;
  }

  return <MemberHome canUpload={role === "member"} organizationId={organizationId} />;
}
