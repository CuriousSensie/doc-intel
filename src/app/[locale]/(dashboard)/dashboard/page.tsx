import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { DocumentProcessingRefresh } from "@/components/documents/document-processing-refresh";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { documentsConfig } from "@/config/documents";
import { isFeatureEnabled } from "@/config/features";
import { getOwnerAdminSummary, getMemberSummary } from "@/modules/dashboard/dashboard.service";
import { requireUser } from "@/modules/auth/session";
import { listRecentUploads } from "@/modules/documents/documents.service";
import { listImportJobs } from "@/modules/imports/imports.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { getMembership } from "@/modules/organizations/organizations.service";
import { createClient } from "@/lib/supabase/server";

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

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function DocumentUploadPanel({ organizationId }: { organizationId: string }) {
  const [uploads, t] = await Promise.all([
    listRecentUploads(organizationId),
    getTranslations("dashboard.home")
  ]);
  const inFlightUploads = uploads.filter((upload) => upload.status !== "completed");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uploadADocument")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted">
          {t("maxSizePerFile", { size: formatSize(documentsConfig.maxSizeBytes) })}
        </p>
        <DocumentUploadForm />
        {inFlightUploads.length > 0 ? (
          <div className="grid gap-2">
            <DocumentProcessingRefresh active />
            <h2 className="text-sm font-semibold text-muted">{t("processing")}</h2>
            {inFlightUploads.map((upload) => (
              <div
                className="flex flex-col justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2 sm:flex-row sm:items-center"
                key={upload.id}
              >
                <div>
                  <p className="font-semibold">{upload.filename}</p>
                  <p className="mt-1 text-xs text-muted">
                    {formatSize(upload.size_bytes)} &middot;{" "}
                    {new Date(upload.created_at).toLocaleString()}
                    {upload.error_message ? ` - ${upload.error_message}` : ""}
                  </p>
                </div>
                <DocumentStatusBadge status={upload.status} />
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
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

async function ActivityHub({
  organizationId,
  userId,
  canWrite
}: {
  organizationId: string;
  userId: string;
  canWrite: boolean;
}) {
  const db = await createClient();
  const ctx = { db, orgId: organizationId, actorId: userId, correlationId: "dashboard" };
  const [summary, imports, t] = await Promise.all([
    getMemberSummary(organizationId),
    isFeatureEnabled("imports")
      ? listImportJobs(ctx).then((jobs) => jobs.slice(0, 5))
      : Promise.resolve([]),
    getTranslations("dashboard.home")
  ]);
  const items = [
    ...summary.attentionDocuments.map((doc) => ({
      key: `doc-${doc.id}`,
      href: `/dashboard/documents/${doc.id}`,
      title: doc.title,
      meta: t("documentNeedsAttention"),
      badge: doc.status,
      badgeVariant: "danger" as const
    })),
    ...summary.recentUploads.slice(0, 5).map((upload) => ({
      key: `upload-${upload.id}`,
      href: "/dashboard/documents",
      title: upload.filename,
      meta: new Date(upload.created_at).toLocaleString(),
      badge: upload.status,
      badgeVariant: "muted" as const
    })),
    ...imports.map((job) => ({
      key: `import-${job.id}`,
      href: `/dashboard/imports/${job.id}`,
      title: job.source_filename ?? t("untitledImport"),
      meta: t("importRows", { count: job.total_rows }),
      badge: job.status,
      badgeVariant: "outline" as const
    }))
  ].slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("activity")}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/documents">{t("openDocuments")}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/views">{t("openViews")}</Link>
          </Button>
          {canWrite && isFeatureEnabled("imports") ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/imports">{t("openImports")}</Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
            {t("noActivity")}
          </p>
        ) : (
          items.map((item) => (
            <Link
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2 hover:bg-panel-strong/40"
              href={item.href}
              key={item.key}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">{item.meta}</span>
              </span>
              <Badge variant={item.badgeVariant}>{item.badge}</Badge>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const { profile, user } = await requireUser("/dashboard");
  const t = await getTranslations("dashboard.home");
  const organizationId = isFeatureEnabled("organizations")
    ? await getActiveOrganizationId(user.id)
    : null;

  return (
    <div className="grid gap-5">
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
  const canUpload = role === "owner" || role === "admin" || role === "member";

  if (role === "owner" || role === "admin") {
    return (
      <div className="grid gap-4">
        <ActivityHub canWrite organizationId={organizationId} userId={userId} />
        {canUpload ? <DocumentUploadPanel organizationId={organizationId} /> : null}
        <OwnerAdminHome organizationId={organizationId} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <ActivityHub canWrite={canUpload} organizationId={organizationId} userId={userId} />
      {canUpload ? <DocumentUploadPanel organizationId={organizationId} /> : null}
      <MemberHome canUpload={canUpload} organizationId={organizationId} />
    </div>
  );
}
