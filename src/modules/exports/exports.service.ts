import type { ServiceContext } from "@/lib/service-context";
import type { Document } from "@/modules/documents/documents.service";

export type ExportRow = {
  documentId: string;
  title: string;
  documentTypeKey: string | null;
  documentDate: string | null;
  status: string;
};

export type ResolvedExportData = {
  rows: ExportRow[];
};

export async function resolveExportData(
  ctx: ServiceContext,
  documentIds: string[]
): Promise<ResolvedExportData> {
  if (documentIds.length === 0) return { rows: [] };

  const { data: documents, error: docsError } = await ctx.db
    .from("documents")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .in("id", documentIds);
  if (docsError) throw docsError;

  const rows: ExportRow[] = (documents ?? []).map((doc: Document) => ({
    documentId: doc.id,
    title: doc.title,
    documentTypeKey: doc.document_type_key,
    documentDate: doc.document_date,
    status: doc.status
  }));

  return { rows };
}
