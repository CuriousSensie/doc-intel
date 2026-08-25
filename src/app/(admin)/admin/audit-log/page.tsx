import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listAuditLogs } from "@/modules/admin/audit-log.service";

export const dynamic = "force-dynamic";

export default async function AdminAuditLogPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const params = await searchParams;
  const { items, nextCursor } = await listAuditLogs({ cursor: params.cursor });

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Admin</p>
        <h1 className="mt-3 text-3xl font-black">Audit Log</h1>
        <p className="mt-3 leading-7 text-muted">
          Security and state-changing events across the app. Rows older than 30 days are purged.
        </p>
      </section>

      <section className="grid gap-3">
        {items.length === 0 ? (
          <p className="rounded-lg border border-border bg-panel p-6 text-muted">No events recorded yet.</p>
        ) : (
          items.map((entry) => (
            <div className="rounded-lg border border-border bg-panel p-4 shadow-sm" key={entry.id}>
              <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                <p className="font-mono text-sm font-semibold">{entry.action}</p>
                <p className="text-xs text-muted">{new Date(entry.created_at).toLocaleString()}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                actor: {entry.actor_id ?? "system"}
                {entry.entity_type ? ` · ${entry.entity_type}${entry.entity_id ? `:${entry.entity_id}` : ""}` : ""}
                {entry.organization_id ? ` · org:${entry.organization_id}` : ""}
              </p>
            </div>
          ))
        )}
      </section>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={`/admin/audit-log?cursor=${encodeURIComponent(nextCursor)}`}>Next page</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
