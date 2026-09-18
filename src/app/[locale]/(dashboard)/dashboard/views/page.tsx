import { getLocale, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { SavedViewRowActions } from "@/components/saved-views/saved-view-row-actions";
import { TrackedViewLink } from "@/components/saved-views/tracked-view-link";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { ensureStarterViews, type SavedView } from "@/modules/saved-views/saved-views.service";
import { buildRequestContext } from "@/lib/service-context";

export const dynamic = "force-dynamic";

function hrefFor(view: SavedView): string {
  const filters = (view.filters ?? {}) as Record<string, unknown>;

  if (view.scope === "entities") {
    const entityTypeKey = filters.entityTypeKey;
    return typeof entityTypeKey === "string"
      ? `/dashboard/entities/${entityTypeKey}`
      : "/dashboard/entities";
  }

  return `/dashboard/documents?savedViewId=${view.id}`;
}

export default async function ViewsPage() {
  requireFeature("entities");
  await requireUser("/dashboard/views");
  const ctx = await buildRequestContext();
  const [views, t, locale] = await Promise.all([
    ensureStarterViews(ctx),
    getTranslations("savedViews.page"),
    getLocale()
  ]);
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("description")}</p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.name")}</TableHead>
            <TableHead>{t("columns.kind")}</TableHead>
            <TableHead>{t("columns.scope")}</TableHead>
            <TableHead>{t("columns.visibility")}</TableHead>
            <TableHead>{t("columns.created")}</TableHead>
            <TableHead className="w-12 text-right">{t("columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {views.map((view) => {
            const href = hrefFor(view);
            return (
              <TableRow key={view.id}>
                <TableCell>
                  <TrackedViewLink
                    className="font-semibold hover:underline"
                    href={href}
                    id={view.id}
                    name={view.name}
                  >
                    {view.name}
                  </TrackedViewLink>
                </TableCell>
                <TableCell>
                  <Badge variant={view.view_kind === "static" ? "accent" : "outline"}>
                    {view.view_kind === "static" ? t("static") : t("dynamic")}
                  </Badge>
                </TableCell>
                <TableCell className="capitalize text-muted">{view.scope}</TableCell>
                <TableCell>
                  <Badge variant={view.is_shared ? "outline" : "muted"}>
                    {view.is_shared ? t("shared") : t("personal")}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted">
                  {dateFormatter.format(new Date(view.created_at))}
                </TableCell>
                <TableCell className="text-right">
                  <SavedViewRowActions href={href} id={view.id} name={view.name} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
