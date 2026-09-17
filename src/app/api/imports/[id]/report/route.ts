import { apiError } from "@/lib/api-response";
import { AuthenticationError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { getAuthContext } from "@/modules/auth/session";
import { getImportJob } from "@/modules/imports/imports.service";
import { buildImportReportCsv } from "@/modules/imports/imports.report";

export const dynamic = "force-dynamic";

// specs/06-importer.md §Reporting: "GET /imports/:id/report returns CSV". Generated live from
// import_rows on every request rather than a pre-built stored file (unlike exports, which are
// large enough to be worth generating once in the worker) — a report is small (bounded by
// total_rows <= 50,000) and always reflects the row statuses as they stand right now, including
// mid-run.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    requireFeature("imports");
    const { id } = await params;
    const ctx = await buildRequestContext();
    const job = await getImportJob(ctx, id);
    const csv = await buildImportReportCsv(ctx, id);
    const filename = `${job.source_filename ?? "import"}-report.csv`;
    const asciiFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
