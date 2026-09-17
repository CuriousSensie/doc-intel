import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled } from "@/config/features";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function loadStats() {
  const admin = createAdminClient();

  const [{ count: userCount }, organizationCount, subscriptionCount, recentSignups] =
    await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      isFeatureEnabled("organizations")
        ? admin.from("organizations").select("id", { count: "exact", head: true })
        : Promise.resolve({ count: null }),
      isFeatureEnabled("billing")
        ? admin
            .from("subscriptions")
            .select("id", { count: "exact", head: true })
            .in("status", ["active", "trialing"])
        : Promise.resolve({ count: null }),
      admin
        .from("profiles")
        .select("id, email, name, created_at")
        .order("created_at", { ascending: false })
        .limit(5)
    ]);

  return {
    userCount: userCount ?? 0,
    organizationCount: organizationCount.count,
    subscriptionCount: subscriptionCount.count,
    recentSignups: recentSignups.data ?? []
  };
}

export default async function AdminDashboardPage() {
  const [stats, t] = await Promise.all([loadStats(), getTranslations("admin")]);

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">{t("dashboard.title")}</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-border p-4">
            <p className="text-sm text-muted">{t("dashboard.stats.users")}</p>
            <p className="mt-1 text-2xl font-black">{stats.userCount}</p>
          </div>
          {stats.organizationCount !== null ? (
            <div className="rounded-md border border-border p-4">
              <p className="text-sm text-muted">{t("dashboard.stats.organizations")}</p>
              <p className="mt-1 text-2xl font-black">{stats.organizationCount}</p>
            </div>
          ) : null}
          {stats.subscriptionCount !== null ? (
            <div className="rounded-md border border-border p-4">
              <p className="text-sm text-muted">{t("dashboard.stats.activeSubscriptions")}</p>
              <p className="mt-1 text-2xl font-black">{stats.subscriptionCount}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/users">{t("dashboard.actions.manageUsers")}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/organizations">{t("dashboard.actions.manageOrganizations")}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/audit-log">{t("dashboard.actions.viewAuditLog")}</Link>
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h2 className="text-xl font-black">{t("dashboard.recentSignups.title")}</h2>
        <div className="mt-5 grid gap-3">
          {stats.recentSignups.length === 0 ? (
            <p className="text-muted">{t("dashboard.recentSignups.empty")}</p>
          ) : (
            stats.recentSignups.map((profile) => (
              <div
                className="flex items-center justify-between rounded-md border border-border p-3"
                key={profile.id}
              >
                <div>
                  <p className="font-semibold">{profile.name ?? profile.email}</p>
                  <p className="text-sm text-muted">{profile.email}</p>
                </div>
                <p className="text-sm text-muted">
                  {new Date(profile.created_at).toLocaleDateString()}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
