import Link from "next/link";
import { notFound } from "next/navigation";

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
import { getEntityTypeByKey, getVisibleFieldSchema } from "@/modules/entity-types/entity-types.service";

export const dynamic = "force-dynamic";

export default async function EntityDetailPage({
  params
}: {
  params: Promise<{ typeKey: string; id: string }>;
}) {
  requireFeature("entities");
  const { typeKey, id } = await params;
  await requireUser(`/dashboard/entities/${typeKey}/${id}`);
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
      connection.other.kind === "document" ? "Documents" : (connection.other.entityTypeName ?? "Other");
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
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4">
            {connectionCountsByGroup.size > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>At a glance</CardTitle>
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
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {fieldSchema.length === 0 ? (
                  <p className="text-muted">No fields defined for this entity type.</p>
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
              <CardTitle>Connections</CardTitle>
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
                <p className="text-sm text-muted">No activity recorded yet.</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {activity.items.map((row) => (
                    <li className="border-b border-border pb-3 last:border-0 last:pb-0" key={row.id}>
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

      <Link className="text-sm text-muted underline underline-offset-4" href={`/dashboard/entities/${typeKey}`}>
        Back to {entityType.name_plural.toLowerCase()}
      </Link>
    </div>
  );
}
