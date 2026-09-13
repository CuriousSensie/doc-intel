import { notFound } from "next/navigation";

import { ConnectionsPanel } from "@/components/documents/connections-panel";
import { PdfViewer } from "@/components/documents/pdf-viewer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotFoundError } from "@/lib/errors";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getDocument, getDocumentHistory } from "@/modules/documents/documents.service";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

const FAILED_STATUSES = new Set(["failed", "orphaned", "expired"]);
const DONE_STATUSES = new Set(["ready", "completed"]);

function StatusBadge({ status }: { status: string }) {
  if (FAILED_STATUSES.has(status)) return <Badge variant="danger">{status}</Badge>;
  if (DONE_STATUSES.has(status)) return <Badge variant="accent">{status}</Badge>;
  return <Badge variant="muted">{status}</Badge>;
}

// specs/12-agent-rules.md rule 9: dd.mm.yyyy for Slovenian locale.
function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("sl-SI") : "—";
}

export default async function DocumentDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  requireFeature("documents");
  const [{ id }, { user }] = await Promise.all([params, requireUser("/dashboard/documents")]);
  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) notFound();

  // specs/03-api.md: cross-tenant access is 404, never 403 — getDocument()'s own RLS-scoped
  // query already returns this as "not found" rather than a distinguishable denial.
  let document: Awaited<ReturnType<typeof getDocument>>;
  try {
    document = await getDocument(organizationId, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // Best-effort — a missing/unreachable Paperless history endpoint shouldn't break the page.
  const history = await getDocumentHistory(organizationId, id).catch(() => []);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-black break-words">{document.title}</h1>
          <StatusBadge status={document.status} />
        </div>
        <PdfViewer documentId={document.id} title={document.title} />
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted">Type</span>
              <span className="text-right">{document.document_type_key ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Correspondent</span>
              <span className="text-right">{document.correspondent_name ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Date</span>
              <span className="text-right">{formatDate(document.document_date)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Pages</span>
              <span className="text-right">{document.page_count ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        {document.paperless === null ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted">
            Live document data is unavailable right now — showing the last synced metadata only.
          </p>
        ) : null}

        {document.paperless && document.paperless.customFields.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Custom fields</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {document.paperless.customFields.map((field) => (
                <div className="flex justify-between gap-3" key={field.field}>
                  <span className="text-muted">Field #{field.field}</span>
                  <span className="text-right">{String(field.value)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectionsPanel connections={document.connections} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted">No history yet.</p>
            ) : (
              <ul className="grid gap-3 text-sm">
                {history.map((entry) => (
                  <li
                    className="border-b border-border pb-3 last:border-0 last:pb-0"
                    key={`${entry.source}-${entry.id}`}
                  >
                    <p className="font-semibold">
                      {entry.action}
                      {entry.source === "paperless" && entry.actorUsername
                        ? ` — ${entry.actorUsername}`
                        : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {new Date(entry.timestamp).toLocaleString("sl-SI")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
