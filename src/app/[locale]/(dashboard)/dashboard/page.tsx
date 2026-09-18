import { getTranslations } from "next-intl/server";

import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { MemberDashboard } from "@/components/dashboard/member-dashboard";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { isFeatureEnabled } from "@/config/features";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

// Compact "drop files or click to upload" widget, header row only — replaces the old full-width
// upload panel + in-flight "Processing" list (design feedback: the header row must stay compact,
// no separate processing status section).
async function CompactUploadCard({
  organizationId,
  userId
}: {
  organizationId: string;
  userId: string;
}) {
  const membership = await getMembership(organizationId, userId);
  if (membership?.role === "read-only") return null;

  return (
    <Card className="w-full shrink-0 lg:w-96">
      <CardContent className="py-3">
        <DocumentUploadForm compact />
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
  const isOwner = membership?.role === "owner";
  const canWrite = membership?.role !== "read-only";

  return isOwner ? (
    <OwnerDashboard organizationId={organizationId} selectedMemberId={selectedMemberId} userId={userId} />
  ) : (
    <MemberDashboard canUpload={canWrite} organizationId={organizationId} userId={userId} />
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-black">
            {profile?.name ? t("welcomeBackWithName", { name: profile.name }) : t("welcomeBack")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("signedInAs", { name: profile?.name ?? user.email ?? "" })}
          </p>
        </div>

        {organizationId ? (
          <CompactUploadCard organizationId={organizationId} userId={user.id} />
        ) : null}
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
