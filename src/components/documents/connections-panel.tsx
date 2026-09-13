import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { ConnectionWithOther } from "@/modules/connections/connections.service";

// specs/05-level-1-structure.md: "The Connections panel is the highest-value surface in the
// product. It gets design attention before anything else." Grouped by entity type (falling
// back to a "Documents" group for document-to-document connections) rather than a flat list —
// this is what makes "everything about customer X" a two-second scan.
function groupLabel(connection: ConnectionWithOther): string {
  if (connection.other.kind === "document") return "Documents";
  return connection.other.entityTypeName ?? "Other";
}

function hrefFor(connection: ConnectionWithOther): string {
  if (connection.other.kind === "document") return `/dashboard/documents/${connection.other.id}`;
  if (connection.other.entityTypeKey) {
    return `/dashboard/entities/${connection.other.entityTypeKey}/${connection.other.id}`;
  }
  return "#";
}

const RELATION_LABELS: Record<ConnectionWithOther["relation"], string> = {
  belongs_to: "Belongs to",
  issued_to: "Issued to",
  assigned_to: "Assigned to",
  part_of: "Part of",
  related: "Related"
};

export function ConnectionsPanel({ connections }: { connections: ConnectionWithOther[] }) {
  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted">
        No connections yet.
      </div>
    );
  }

  const groups = new Map<string, ConnectionWithOther[]>();
  for (const connection of connections) {
    const label = groupLabel(connection);
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
                    {connection.other.label ?? "Unknown"}
                  </span>
                ) : (
                  <Link
                    className="truncate text-sm font-semibold hover:underline"
                    href={hrefFor(connection)}
                  >
                    {connection.other.label ?? "Unknown"}
                  </Link>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {connection.other.isDeleted ? <Badge variant="danger">deleted</Badge> : null}
                  <Badge variant="outline">{RELATION_LABELS[connection.relation]}</Badge>
                  {connection.createdVia !== "manual" ? (
                    <Badge variant="muted">via {connection.createdVia}</Badge>
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
