import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
import { Button } from "@/components/ui/button";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { leaveOrganizationAction } from "@/modules/organizations/organizations.actions";
import { listUserOrganizations } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  requireFeature("organizations");
  const context = await requireUser("/organizations");
  const t = await getTranslations("organizations");
  const [params, memberships, activeOrganizationId] = await Promise.all([
    searchParams,
    listUserOrganizations(context.user.id),
    getActiveOrganizationId(context.user.id)
  ]);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-black">{t("list.title")}</h1>
          </div>
          <Button asChild>
            <Link href="/organizations/new">{t("list.create")}</Link>
          </Button>
        </div>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <OrganizationSwitcher
            activeOrganizationId={activeOrganizationId}
            next="/organizations"
            organizations={memberships.map((membership) => membership.organization)}
          />
          <FormMessage error={params.error} message={params.message} />
        </div>
      </section>

      <section className="grid gap-3">
        {memberships.length === 0 ? (
          <p className="rounded-lg border border-border bg-panel p-6 text-muted">
            {t("list.empty")}
          </p>
        ) : (
          memberships.map(({ organization, role }) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm sm:flex-row sm:items-center"
              key={organization.id}
            >
              <div>
                <p className="font-semibold">
                  {organization.name}
                  {organization.id === activeOrganizationId ? (
                    <span className="ml-2 rounded-full bg-panel-strong px-2 py-0.5 text-xs font-semibold text-muted">
                      {t("list.active")}
                    </span>
                  ) : null}
                </p>
                <p className="text-sm capitalize text-muted">{role}</p>
              </div>
              <form action={leaveOrganizationAction}>
                <input name="organizationId" type="hidden" value={organization.id} />
                <Button type="submit" variant="outline">
                  {t("list.leave")}
                </Button>
              </form>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
