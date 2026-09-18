import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { DocumentProcessingRefresh } from "@/components/documents/document-processing-refresh";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { MemberDashboard } from "@/components/dashboard/member-dashboard";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { documentsConfig } from "@/config/documents";
import { isFeatureEnabled } from "@/config/features";
import { getAttentionDocuments, getRecentUploads } from "@/modules/dashboard/dashboard.service";
import { requireUser } from "@/modules/auth/session";
import { listRecentUploads } from "@/modules/documents/documents.service";
import { listImportJobs } from "@/modules/imports/imports.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { getMembership } from "@/modules/organizations/organizations.service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  const [attentionDocuments, recentUploads, imports, t] = await Promise.all([
    getAttentionDocuments(organizationId),
    getRecentUploads(organizationId),
    isFeatureEnabled("imports")
      ? listImportJobs(ctx).then((jobs) => jobs.slice(0, 5))
      : Promise.resolve([]),
    getTranslations("dashboard.home")
  ]);
  const items = [
    ...attentionDocuments.map((doc) => ({
      key: `doc-${doc.id}`,
      href: `/dashboard/documents/${doc.id}`,
      title: doc.title,
      meta: t("documentNeedsAttention"),
      badge: doc.status,
      badgeVariant: "danger" as const
    })),
    ...recentUploads.slice(0, 5).map((upload) => ({
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

// Role gate (per project decision, overrides the stale organization_role enum grouping): the
// only roles that matter for this page are "owner" (org creator) and everyone else ("member",
// with or without the read-only permission). The unrelated platform-level admin
// (profiles.is_app_admin, gates /admin, all-tenant access) never affects this branch.
async function RoleGatedHome({
  organizationId,
  userId,
  selectedMemberId
}: {
  organizationId: string;
  userId: string;
  selectedMemberId?: string;
}) {
  const membership = await getMembership(organizationId, userId);
  const role = membership?.role;
  const isOwner = role === "owner";
  const canWrite = role !== "read-only";

  return (
    <div className="grid gap-4">
      <ActivityHub canWrite={canWrite} organizationId={organizationId} userId={userId} />
      {canWrite ? <DocumentUploadPanel organizationId={organizationId} /> : null}
      {isOwner ? (
        <OwnerDashboard
          organizationId={organizationId}
          selectedMemberId={selectedMemberId}
          userId={userId}
        />
      ) : (
        <MemberDashboard canUpload={canWrite} organizationId={organizationId} userId={userId} />
      )}
    </div>
  );
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { profile, user } = await requireUser("/dashboard");
  const { member: selectedMemberId } = await searchParams;
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
        <RoleGatedHome
          organizationId={organizationId}
          selectedMemberId={selectedMemberId}
          userId={user.id}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted">
          {t("notInOrganization")}
        </p>
      )}
    </div>
  );
}
