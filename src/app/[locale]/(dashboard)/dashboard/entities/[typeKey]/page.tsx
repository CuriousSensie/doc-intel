import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EntityFieldInput } from "@/components/entities/entity-field-input";
import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Badge } from "@/components/ui/badge";
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
import { NotFoundError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { createEntityFormAction } from "@/modules/entities/entities.actions";
import { listEntities } from "@/modules/entities/entities.service";
import { getEntityTypeByKey, getVisibleFieldSchema } from "@/modules/entity-types/entity-types.service";

export const dynamic = "force-dynamic";

export default async function EntityTypeListPage({
  params,
  searchParams
}: {
  params: Promise<{ typeKey: string }>;
  searchParams: Promise<{ q?: string; error?: string; message?: string }>;
}) {
  requireFeature("entities");
  const [{ typeKey }, search, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("entities.list")
  ]);
  await requireUser(`/dashboard/entities/${typeKey}`);
  const ctx = await buildRequestContext();

  let entityType: Awaited<ReturnType<typeof getEntityTypeByKey>>;
  try {
    entityType = await getEntityTypeByKey(ctx, typeKey);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const fieldSchema = getVisibleFieldSchema(entityType);
  const { items: entities } = await listEntities(ctx, {
    entityTypeId: entityType.id,
    q: search.q
  });

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{entityType.name_plural}</h1>
          <p className="mt-1 text-sm text-muted">{t("total", { count: entities.length })}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/entities">{t("allEntities")}</Link>
        </Button>
      </div>

      <FormMessage error={search.error} message={search.message} />

      <form className="flex gap-2" method="get">
        <TextField
          aria-label={t("searchLabel")}
          className="flex-1"
          defaultValue={search.q ?? ""}
          label=""
          name="q"
          placeholder={t("searchPlaceholder", { typePlural: entityType.name_plural.toLowerCase() })}
        />
        <Button type="submit" variant="outline">
          {t("search")}
        </Button>
      </form>

      {entities.length === 0 ? (
        <EmptyState
          description={t("emptyDescription", { typeSingular: entityType.name.toLowerCase() })}
          title={t("emptyTitle", { typePlural: entityType.name_plural.toLowerCase() })}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("nameColumn")}</TableHead>
              <TableHead>{t("statusColumn")}</TableHead>
              <TableHead>{t("createdColumn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entities.map((entity) => (
              <TableRow key={entity.id}>
                <TableCell>
                  <Link
                    className="font-semibold hover:underline"
                    href={`/dashboard/entities/${typeKey}/${entity.id}`}
                  >
                    {entity.display_name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={entity.status === "active" ? "accent" : "muted"}>
                    {entity.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted">
                  {new Date(entity.created_at).toLocaleDateString("sl-SI")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("newEntity", { typeSingular: entityType.name.toLowerCase() })}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createEntityFormAction} className="grid gap-4 sm:grid-cols-2">
            <input name="entityTypeId" type="hidden" value={entityType.id} />
            <input name="entityTypeKey" type="hidden" value={typeKey} />
            <TextField label={t("nameColumn")} name="displayName" required />
            {fieldSchema.map((field) => (
              <EntityFieldInput field={field} key={field.key} />
            ))}
            <Button className="sm:col-span-2" type="submit">
              {t("create")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
