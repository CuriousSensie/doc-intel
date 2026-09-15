"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  bulkConnectDocumentsAction,
  getBackgroundOperationAction,
  undoBulkConnectAction
} from "@/modules/connections/connections.actions";
import { countDocumentsMatchingFilterAction } from "@/modules/documents/documents.actions";
import type { Document, ListDocumentsOptions } from "@/modules/documents/documents.service";
import { createExportAction } from "@/modules/exports/exports.actions";

type SearchResult = {
  kind: "entity";
  id: string;
  label: string;
  entityTypeKey: string | null;
  entityTypeName: string | null;
};

const FAILED_STATUSES = new Set(["failed", "orphaned", "expired"]);
const DONE_STATUSES = new Set(["ready", "completed"]);

function StatusBadge({ status }: { status: string }) {
  if (FAILED_STATUSES.has(status)) return <Badge variant="danger">{status}</Badge>;
  if (DONE_STATUSES.has(status)) return <Badge variant="accent">{status}</Badge>;
  return <Badge variant="muted">{status}</Badge>;
}

const POLL_INTERVAL_MS = 1500;

export function DocumentsBulkList({
  documents,
  filter
}: {
  documents: Document[];
  filter: ListDocumentsOptions;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [matchingCount, setMatchingCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastOperationId, setLastOperationId] = useState<string | null>(null);
  const [pollingOperationId, setPollingOperationId] = useState<string | null>(null);
  // Exposed via a data attribute below purely as an e2e test hook (bulk-and-export.spec.ts) —
  // downloads can't be asserted reliably through Playwright's download-UI heuristics, so the
  // test polls/fetches this operation's status and file directly instead.
  const [exportOperationId, setExportOperationId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectionCount = selectAllMatching ? (matchingCount ?? 0) : selectedIds.size;
  const hasSelection = selectionCount > 0;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function toggle(id: string) {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelectAllMatching(false);
    setSelectedIds((prev) =>
      prev.size === documents.length ? new Set() : new Set(documents.map((d) => d.id))
    );
  }

  async function handleSelectAllMatching() {
    const { count } = await countDocumentsMatchingFilterAction(filter);
    setMatchingCount(count);
    setSelectAllMatching(true);
    setSelectedIds(new Set());
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
    setMatchingCount(null);
  }

  function pollOperation(operationId: string) {
    setPollingOperationId(operationId);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const op = await getBackgroundOperationAction(operationId);
      if (op.status === "completed" || op.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setPollingOperationId(null);
        setStatus(
          op.status === "completed"
            ? `Connected ${op.success_count} document(s)${op.failure_count > 0 ? `, ${op.failure_count} failed` : ""}.`
            : `Bulk connect failed: ${op.error_message ?? "unknown error"}`
        );
        if (op.status === "completed" && op.kind === "bulk_connect") setLastOperationId(operationId);
        router.refresh();
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
    const body = await res.json();
    if (res.ok) setResults(body.data as SearchResult[]);
  }

  function handleConnect(result: SearchResult) {
    startTransition(async () => {
      const summary = await bulkConnectDocumentsAction({
        documentIds: selectAllMatching ? undefined : [...selectedIds],
        filter: selectAllMatching ? filter : undefined,
        targetKind: "entity",
        targetId: result.id
      });
      setPickerOpen(false);
      setQuery("");
      setResults([]);
      clearSelection();

      if (summary.mode === "sync") {
        setStatus(
          `Connected ${summary.created} document(s)${summary.skipped > 0 ? `, ${summary.skipped} already connected` : ""}${summary.failed > 0 ? `, ${summary.failed} failed` : ""}.`
        );
        setLastOperationId(summary.operationId);
        router.refresh();
      } else {
        setStatus(`Connecting ${summary.total} documents in the background…`);
        pollOperation(summary.operationId);
      }
    });
  }

  function handleUndo() {
    if (!lastOperationId) return;
    startTransition(async () => {
      await undoBulkConnectAction(lastOperationId);
      setLastOperationId(null);
      setStatus("Undone.");
      router.refresh();
    });
  }

  function handleExport(format: "csv" | "xlsx") {
    startTransition(async () => {
      const { operationId } = await createExportAction({
        documentIds: selectAllMatching ? undefined : hasSelection ? [...selectedIds] : undefined,
        filter: selectAllMatching || !hasSelection ? filter : undefined,
        format
      });
      setExportOperationId(operationId);
      setStatus("Preparing export…");
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const op = await getBackgroundOperationAction(operationId);
        if (op.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus(null);
          // Real navigation, not router.push() — this hits a Route Handler that 307s to a
          // signed, cross-origin storage URL, not a Next.js page.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = `/api/exports/${operationId}/download`;
        } else if (op.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus(`Export failed: ${op.error_message ?? "unknown error"}`);
        }
      }, POLL_INTERVAL_MS);
    });
  }

  return (
    <div className="grid gap-3" data-export-operation-id={exportOperationId ?? ""}>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm">
        <input
          checked={documents.length > 0 && selectedIds.size === documents.length}
          className="size-4"
          onChange={toggleAllOnPage}
          type="checkbox"
        />
        <span className="text-muted">Select page</span>
        {matchingCount === null ? (
          <button className="underline underline-offset-4" onClick={handleSelectAllMatching} type="button">
            Select all matching filter
          </button>
        ) : null}

        {hasSelection ? (
          <>
            <span className="font-semibold">{selectionCount} selected</span>
            <Button disabled={isPending} onClick={() => setPickerOpen((v) => !v)} size="sm" variant="outline">
              Connect to entity
            </Button>
            <Button disabled={isPending} onClick={() => handleExport("csv")} size="sm" variant="outline">
              Export CSV
            </Button>
            <Button disabled={isPending} onClick={() => handleExport("xlsx")} size="sm" variant="outline">
              Export XLSX
            </Button>
            <Button onClick={clearSelection} size="sm" variant="ghost">
              Clear
            </Button>
          </>
        ) : (
          <>
            <span className="ml-auto" />
            <Button disabled={isPending} onClick={() => handleExport("csv")} size="sm" variant="outline">
              Export view (CSV)
            </Button>
            <Button disabled={isPending} onClick={() => handleExport("xlsx")} size="sm" variant="outline">
              Export view (XLSX)
            </Button>
          </>
        )}
      </div>

      {pickerOpen ? (
        <div className="grid gap-2 rounded-md border border-border bg-panel p-3">
          <Input
            autoFocus
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search customers, projects, contracts..."
            value={query}
          />
          {results.length > 0 ? (
            <ul className="grid gap-1">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-strong disabled:opacity-50"
                    disabled={isPending}
                    onClick={() => handleConnect(result)}
                    type="button"
                  >
                    <span className="truncate font-semibold">{result.label}</span>
                    <span className="shrink-0 text-xs text-muted">{result.entityTypeName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {status || pollingOperationId ? (
        <div className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-sm">
          <span>{status}</span>
          {lastOperationId ? (
            <button className="underline underline-offset-4" onClick={handleUndo} type="button">
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="grid gap-3">
        {documents.length === 0 ? null : (
          documents.map((document) => (
            <div
              className="flex items-center gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm transition-colors hover:bg-panel-strong/40"
              data-document-row={document.id}
              key={document.id}
            >
              <input
                checked={selectedIds.has(document.id)}
                className="size-4 shrink-0"
                onChange={() => toggle(document.id)}
                type="checkbox"
              />
              <Link className="flex flex-1 flex-col justify-between gap-3 sm:flex-row sm:items-center" href={`/dashboard/documents/${document.id}`}>
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
            </div>
          ))
        )}
      </section>
    </div>
  );
}
