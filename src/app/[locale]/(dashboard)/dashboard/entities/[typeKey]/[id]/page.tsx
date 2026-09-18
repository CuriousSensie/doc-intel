import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ConnectionPicker } from "@/components/connections/connection-picker";
import { ConnectionsPanel } from "@/components/documents/connections-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotFoundError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { listAuditLogsForSubject } from "@/modules/admin/audit-log.service";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getConnections } from "@/modules/connections/connections.service";
import { getEntity } from "@/modules/entities/entities.service";
import {
  getEntityTypeByKey,
  getVisibleFieldSchema
} from "@/modules/entity-types/entity-types.service";

export const dynamic = "force-dynamic";

const detailTabClassName =
  "rounded-none border-b-2 border-transparent bg-transparent px-0.5 pb-2 pt-1 text-sm font-semibold text-muted shadow-none transition-colors data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

export default async function EntityDetailPage({
  params
}: {
  params: Promise<{ typeKey: string; id: string }>;
}) {
  requireFeature("entities");
  const { typeKey, id } = await params;
  const [, t] = await Promise.all([
    requireUser(`/dashboard/entities/${typeKey}/${id}`),
    getTranslations("entities.detail")
  ]);
  const ctx = await buildRequestContext();

  let entityType: Awaited<ReturnType<typeof getEntityTypeByKey>>;
  let entity: Awaited<ReturnType<typeof getEntity>>;
  try {
    entityType = await getEntityTypeByKey(ctx, typeKey);
    entity = await getEntity(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (entity.entity_type_id !== entityType.id) notFound();

  const [connections, activity] = await Promise.all([
    getConnections(ctx, "entity", id),
    listAuditLogsForSubject("entity", id, { limit: 20 })
  ]);

  const fieldSchema = getVisibleFieldSchema(entityType);
  const data = entity.data as Record<string, unknown>;
  const connectionCountsByGroup = new Map<string, number>();
  for (const connection of connections) {
    const label =
      connection.other.kind === "document"
        ? t("documents")
        : (connection.other.entityTypeName ?? t("other"));
    connectionCountsByGroup.set(label, (connectionCountsByGroup.get(label) ?? 0) + 1);
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">
            {entityType.name}
          </p>
          <h1 className="text-3xl font-black">{entity.display_name}</h1>
        </div>
        <Badge variant={entity.status === "active" ? "accent" : "muted"}>{entity.status}</Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="h-auto w-full justify-start gap-4 rounded-none border-0 border-b border-border bg-transparent p-0">
          <TabsTrigger className={detailTabClassName} value="overview">
            {t("overview")}
          </TabsTrigger>
          <TabsTrigger className={detailTabClassName} value="connections">
            {t("connections")}
          </TabsTrigger>
          <TabsTrigger className={detailTabClassName} value="activity">
            {t("activity")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4">
            {connectionCountsByGroup.size > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("atAGlance")}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  {[...connectionCountsByGroup.entries()].map(([label, count]) => (
                    <div
                      className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2"
                      key={label}
                    >
                      <span className="text-sm text-muted">{label}</span>
                      <span className="text-lg font-black">{count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>{t("details")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {fieldSchema.length === 0 ? (
                  <p className="text-muted">{t("noFields")}</p>
                ) : (
                  fieldSchema.map((field) => (
                    <div className="flex justify-between gap-3" key={field.key}>
                      <span className="text-muted">{field.label}</span>
                      <span className="text-right">
                        {data[field.key] !== undefined && data[field.key] !== null
                          ? String(data[field.key])
                          : "—"}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="connections">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>{t("connections")}</CardTitle>
              <ConnectionPicker sourceId={entity.id} sourceKind="entity" />
            </CardHeader>
            <CardContent>
              <ConnectionsPanel connections={connections} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent className="pt-6">
              {activity.items.length === 0 ? (
                <p className="text-sm text-muted">{t("noActivity")}</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {activity.items.map((row) => (
                    <li
                      className="border-b border-border pb-3 last:border-0 last:pb-0"
                      key={row.id}
                    >
                      <p className="font-semibold">{row.action}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {new Date(row.created_at).toLocaleString("sl-SI")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Link
        className="text-sm text-muted underline underline-offset-4"
        href={`/dashboard/entities/${typeKey}`}
      >
        {t("backToList", { typePlural: entityType.name_plural.toLowerCase() })}
      </Link>
    </div>
  );
}
