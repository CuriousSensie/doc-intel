import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
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
    <div className="grid min-w-0 gap-5">
      <section className="rounded-lg border border-border bg-panel p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row">
          <FormMessage error={params.error} message={params.message} />
          <div>
            <h1 className="text-3xl font-black">{t("list.title")}</h1>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <div className="max-w-sm">
              <OrganizationSwitcher
                activeOrganizationId={activeOrganizationId}
                next="/organizations"
                organizations={memberships.map((membership) => membership.organization)}
              />
            </div>
            <Button className="max-w-sm" variant={"outline"} asChild>
              <Link href="/organizations/new">{t("list.create")}</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="min-w-0">
        {memberships.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-panel p-6 text-muted">
            {t("list.empty")}
          </p>
        ) : (
          <Table className="min-w-[48rem] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>{t("list.organization")}</TableHead>
                <TableHead className="w-40">{t("list.role")}</TableHead>
                <TableHead className="w-32">{t("list.status")}</TableHead>
                <TableHead className="w-28">
                  <span className="sr-only">{t("list.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.map(({ organization, role }) => (
                <TableRow key={organization.id}>
                  <TableCell>
                    <p className="font-semibold">{organization.name}</p>
                    <p className="text-xs text-muted">{organization.slug}</p>
                  </TableCell>
                  <TableCell className="capitalize text-muted">{role}</TableCell>
                  <TableCell>
                    {organization.id === activeOrganizationId ? (
                      <Badge variant="accent">{t("list.active")}</Badge>
                    ) : (
                      <Badge variant="muted">{t("list.inactive")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <form action={leaveOrganizationAction}>
                      <input name="organizationId" type="hidden" value={organization.id} />
                      <Button size="sm" type="submit" variant="outline">
                        {t("list.leave")}
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
