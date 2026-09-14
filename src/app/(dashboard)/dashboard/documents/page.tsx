import Link from "next/link";

import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { documentsConfig } from "@/config/documents";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { listDocuments, listRecentUploads, type Document } from "@/modules/documents/documents.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FAILED_STATUSES = new Set(["failed", "orphaned", "expired"]);
const DONE_STATUSES = new Set(["ready", "completed"]);
const VALID_DOCUMENT_STATUSES = new Set<Document["status"]>([
  "pending",
  "processing",
  "ready",
  "failed",
  "orphaned"
]);

function asDocumentStatus(value: string | undefined): Document["status"] | undefined {
  return VALID_DOCUMENT_STATUSES.has(value as Document["status"])
    ? (value as Document["status"])
    : undefined;
}

function StatusBadge({ status }: { status: string }) {
  if (FAILED_STATUSES.has(status)) return <Badge variant="danger">{status}</Badge>;
  if (DONE_STATUSES.has(status)) return <Badge variant="accent">{status}</Badge>;
  return <Badge variant="muted">{status}</Badge>;
}

function EmptyDocumentsState() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="w-full rounded-lg border border-border bg-panel p-6 text-center shadow-sm">
        <h1 className="text-3xl font-black">Documents</h1>
        <p className="mt-3 leading-7 text-muted">You are not part of an organization yet.</p>
        <Button asChild className="mt-6">
          <Link href="/organizations/new">Create organization</Link>
        </Button>
      </section>
    </div>
  );
}

export default async function DocumentsPage({
  searchParams
}: {
  searchParams: Promise<{
    documentTypeKey?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    q?: string;
    hasNoConnections?: string;
  }>;
}) {
  requireFeature("documents");
  const [context, search] = await Promise.all([requireUser("/dashboard/documents"), searchParams]);
  const organizationId = await getActiveOrganizationId(context.user.id);

  if (!organizationId) {
    return <EmptyDocumentsState />;
  }

  const [{ items: documents }, uploads] = await Promise.all([
    listDocuments(organizationId, {
      documentTypeKey: search.documentTypeKey,
      status: asDocumentStatus(search.status),
      dateFrom: search.dateFrom,
      dateTo: search.dateTo,
      q: search.q,
      hasNoConnections: search.hasNoConnections === "true"
    }),
    listRecentUploads(organizationId)
  ]);
  const isFiltered = Boolean(
    search.documentTypeKey || search.status || search.dateFrom || search.q || search.hasNoConnections
  );

  // Only surface uploads that haven't (yet, or ever) landed in `documents` — an upload that
  // completed successfully is already represented by its own row in the list below.
  const inFlightUploads = uploads.filter((upload) => upload.status !== "completed");

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">Documents</h1>
        <p className="mt-1 text-sm text-muted">
          Up to {formatSize(documentsConfig.maxSizeBytes)} per file. PDF, PNG, JPEG, TIFF, DOCX,
          XLSX, ODT.
        </p>
        <div className="mt-6">
          <DocumentUploadForm />
        </div>
      </section>

      {inFlightUploads.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold text-muted">Processing</h2>
          {inFlightUploads.map((upload) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm sm:flex-row sm:items-center"
              key={upload.id}
            >
              <div>
                <p className="font-semibold">{upload.filename}</p>
                <p className="mt-1 text-xs text-muted">
                  {formatSize(upload.size_bytes)} &middot;{" "}
                  {new Date(upload.created_at).toLocaleString()}
                  {upload.error_message ? ` — ${upload.error_message}` : ""}
                </p>
              </div>
              <StatusBadge status={upload.status} />
            </div>
          ))}
        </section>
      ) : null}

      {isFiltered ? (
        <div className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
          <span>Showing a filtered view — {documents.length} document(s)</span>
          <Link className="underline underline-offset-4" href="/dashboard/documents">
            Clear filters
          </Link>
        </div>
      ) : null}

      <section className="grid gap-3">
        {documents.length === 0 ? (
          <p className="rounded-lg border border-border bg-panel p-6 text-muted">
            {isFiltered ? "No documents match this view." : "You have no documents yet."}
          </p>
        ) : (
          documents.map((document) => (
            <Link
              className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm transition-colors hover:bg-panel-strong/40 sm:flex-row sm:items-center"
              href={`/dashboard/documents/${document.id}`}
              key={document.id}
            >
              <div>
                <p className="font-semibold">{document.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {document.document_type_key ?? "Uncategorized"}
                  {document.correspondent_name ? ` · ${document.correspondent_name}` : ""}
                  {document.page_count ? ` · ${document.page_count} pages` : ""}
                  {" · "}
                  {new Date(document.created_at).toLocaleString()}
                </p>
              </div>
              <StatusBadge status={document.status} />
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
