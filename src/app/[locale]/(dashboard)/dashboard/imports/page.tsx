import { getLocale, getTranslations } from "next-intl/server";
import { Plus, ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/imports/import-controls";
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
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t("recentImports")}</h2>
          <div className="divide-y divide-border border-y border-border">
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={`/dashboard/imports/${job.id}`}
                className="grid gap-3 px-3 py-5 transition-colors hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_10rem_9rem_1rem] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{job.source_filename ?? t("untitled")}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t(`kind.${job.kind}`)} ·{" "}
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeZone: "Europe/Ljubljana"
                    }).format(new Date(job.created_at))}
                  </p>
                </div>
                <span className="text-sm tabular-nums text-muted">
                  {t("rowCount", { count: job.total_rows })}
                </span>
                <Status status={job.status} />
                <ArrowUpRight aria-hidden size={16} className="hidden text-muted sm:block" />
              </Link>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">{t("historyLimit")}</p>
        </section>
      )}
      {!canWrite && <p className="text-sm text-muted">{t("readOnly")}</p>}
    </div>
  );
}
