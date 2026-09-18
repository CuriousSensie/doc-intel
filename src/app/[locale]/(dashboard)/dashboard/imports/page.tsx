import { getLocale, getTranslations } from "next-intl/server";
import { Plus, ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/imports/import-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { getMembership } from "@/modules/organizations/organizations.service";
import { listImportJobs } from "@/modules/imports/imports.service";

export const dynamic = "force-dynamic";
export default async function ImportsPage() {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  const [jobs, membership, t, locale] = await Promise.all([
    listImportJobs(ctx),
    getMembership(ctx.orgId, ctx.actorId!),
    getTranslations("imports"),
    getLocale()
  ]);
  const canWrite = !!membership && membership.role !== "read-only";
  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-2 max-w-prose text-muted">{t("description")}</p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href="/dashboard/imports/new">
              <Plus size={16} />
              {t("newImport")}
            </Link>
          </Button>
        )}
      </header>
      {jobs.length === 0 ? (
        <section className="grid gap-4 border-y border-border py-10">
          <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
          <p className="max-w-prose text-muted">{t("emptyDescription")}</p>
          <p className="max-w-prose text-sm text-muted">{t("entityOrderWarning")}</p>
          {canWrite && (
            <Link
              className="justify-self-start text-sm font-semibold underline underline-offset-4"
              href="/dashboard/imports/new"
            >
              {t("firstImport")}
            </Link>
          )}
        </section>
      ) : (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">{t("recentImports")}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.file")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.rows")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead className="w-10 text-right">{t("columns.open")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link
                      className="font-semibold hover:underline"
                      href={`/dashboard/imports/${job.id}`}
                    >
                      {job.source_filename ?? t("untitled")}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeZone: "Europe/Ljubljana"
                      }).format(new Date(job.created_at))}
                    </p>
                  </TableCell>
                  <TableCell className="text-muted">{t(`kind.${job.kind}`)}</TableCell>
                  <TableCell className="tabular-nums text-muted">
                    {t("rowCount", { count: job.total_rows })}
                  </TableCell>
                  <TableCell>
                    <Status status={job.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/dashboard/imports/${job.id}`}>
                      <ArrowUpRight aria-hidden size={16} className="ml-auto text-muted" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted">{t("historyLimit")}</p>
        </section>
      )}
      {!canWrite && <p className="text-sm text-muted">{t("readOnly")}</p>}
    </div>
  );
}
