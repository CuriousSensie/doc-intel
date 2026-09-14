import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { ensureStarterViews, type SavedView } from "@/modules/saved-views/saved-views.service";
import { buildRequestContext } from "@/lib/service-context";

export const dynamic = "force-dynamic";

function hrefFor(view: SavedView): string {
  const filters = (view.filters ?? {}) as Record<string, unknown>;

  if (view.scope === "entities") {
    const entityTypeKey = filters.entityTypeKey;
    return typeof entityTypeKey === "string" ? `/dashboard/entities/${entityTypeKey}` : "/dashboard/entities";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/dashboard/documents?${query}` : "/dashboard/documents";
}

export default async function ViewsPage() {
  requireFeature("entities");
  await requireUser("/dashboard/views");
  const ctx = await buildRequestContext();
  const views = await ensureStarterViews(ctx);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div>
        <h1 className="text-3xl font-black">Views</h1>
        <p className="mt-1 text-sm text-muted">
          Saved filters over documents and entities — click one to jump straight to it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {views.map((view) => (
          <Link href={hrefFor(view)} key={view.id}>
            <Card className="transition-colors hover:bg-panel-strong/40">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>{view.name}</CardTitle>
                <Badge variant="outline">{view.scope}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted">
                  {view.is_shared ? "Shared with your organization" : "Personal view"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
