import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { Badge } from "@/components/ui/badge";
import type { ConnectionWithOther } from "@/modules/connections/connections.service";

// specs/05-level-1-structure.md: "The Connections panel is the highest-value surface in the
// product. It gets design attention before anything else." Grouped by entity type (falling
// back to a "Documents" group for document-to-document connections) rather than a flat list —
// this is what makes "everything about customer X" a two-second scan.
function groupLabel(connection: ConnectionWithOther, t: Awaited<ReturnType<typeof getTranslations>>): string {
  if (connection.other.kind === "document") return t("panel.documentsGroup");
  return connection.other.entityTypeName ?? t("panel.otherGroup");
}

function hrefFor(connection: ConnectionWithOther): string {
  if (connection.other.kind === "document") return `/dashboard/documents/${connection.other.id}`;
  if (connection.other.entityTypeKey) {
    return `/dashboard/entities/${connection.other.entityTypeKey}/${connection.other.id}`;
  }
  return "#";
}

export async function ConnectionsPanel({ connections }: { connections: ConnectionWithOther[] }) {
  const t = await getTranslations("connections");

  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted">
        {t("panel.empty")}
      </div>
    );
  }

  const relationLabels: Record<ConnectionWithOther["relation"], string> = {
    belongs_to: t("panel.relations.belongs_to"),
    issued_to: t("panel.relations.issued_to"),
    assigned_to: t("panel.relations.assigned_to"),
    part_of: t("panel.relations.part_of"),
    related: t("panel.relations.related")
  };

  const groups = new Map<string, ConnectionWithOther[]>();
  for (const connection of connections) {
    const label = groupLabel(connection, t);
    const group = groups.get(label) ?? [];
    group.push(connection);
    groups.set(label, group);
  }

  return (
    <div className="grid gap-4">
      {[...groups.entries()].map(([label, group]) => (
        <div key={label}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
          <ul className="mt-2 grid gap-2">
            {group.map((connection) => (
              <li
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2"
                key={connection.id}
              >
                {connection.other.isDeleted ? (
                  <span className="truncate text-sm font-semibold text-muted line-through">
                    {connection.other.label ?? t("panel.unknown")}
                  </span>
                ) : (
                  <Link
                    className="truncate text-sm font-semibold hover:underline"
                    href={hrefFor(connection)}
                  >
                    {connection.other.label ?? t("panel.unknown")}
                  </Link>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {connection.other.isDeleted ? <Badge variant="danger">{t("panel.deleted")}</Badge> : null}
                  <Badge variant="outline">{relationLabels[connection.relation]}</Badge>
                  {connection.createdVia !== "manual" ? (
                    <Badge variant="muted">{t("panel.via", { source: connection.createdVia })}</Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
