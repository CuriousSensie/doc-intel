import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { createEntityTypeFormAction } from "@/modules/entity-types/entity-types.actions";
import { listEntityTypes } from "@/modules/entity-types/entity-types.service";
import { countEntitiesByType } from "@/modules/entities/entities.service";
import { buildRequestContext } from "@/lib/service-context";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function EntitiesIndexPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  requireFeature("entities");
  const [{ user }, params, t] = await Promise.all([
    requireUser("/dashboard/entities"),
    searchParams,
    getTranslations("entities.index")
  ]);
  const ctx = await buildRequestContext();

  const [entityTypes, counts, membership] = await Promise.all([
    listEntityTypes(ctx),
    countEntitiesByType(ctx),
    getMembership(ctx.orgId, user.id)
  ]);

  const canManage = membership?.role === "owner" || membership?.role === "admin";

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("description")}</p>
        </div>
        {canManage ? (
          <Button asChild variant="outline">
            <Link href="/dashboard/entity-types">{t("manageTypes")}</Link>
          </Button>
        ) : null}
      </div>

      <FormMessage error={params.error} message={params.message} />

      {entityTypes.length === 0 ? (
        <EmptyState description={t("emptyDescription")} title={t("emptyTitle")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead>{t("columns.count")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entityTypes.map((type) => (
              <TableRow key={type.id}>
                <TableCell>
                  <Link
                    className="font-semibold hover:underline"
                    href={`/dashboard/entities/${type.key}`}
                  >
                    {type.name_plural}
                  </Link>
                </TableCell>
                <TableCell className="text-muted">{counts[type.id] ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("newEntityType")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createEntityTypeFormAction} className="grid gap-4 sm:grid-cols-3">
              <TextField
                hint={t("keyHint")}
                label={t("keyLabel")}
                name="key"
                placeholder="supplier"
                required
              />
              <TextField label={t("nameLabel")} name="name" placeholder="Supplier" required />
              <TextField
                label={t("pluralNameLabel")}
                name="namePlural"
                placeholder="Suppliers"
                required
              />
              <Button className="sm:col-span-3" type="submit">
                {t("createEntityType")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
