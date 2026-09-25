"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FolderAccessManager } from "@/components/folders/folder-access-manager";
import { FolderMatchEditor } from "@/components/folders/folder-match-editor";
import { FolderTree, UNFILED_KEY } from "@/components/folders/folder-tree";
import type { DocCacheEntry } from "@/components/folders/folder-tree";
import { listFolderDocumentsAction, listFolderTreeAction } from "@/modules/folders/folders.actions";
import type { DocumentPageSize } from "@/modules/documents/documents.service";
import type { Folder } from "@/modules/folders/folders.service";

const PAGE_SIZE: DocumentPageSize = 25;

// Resolves a folder's ancestor id chain by walking parentFolderId on the flat list — same
// technique the old folder-browser-rail.tsx used (ADR-0019: no separate closure table, path_ids
// isn't exposed to the client, so this is the only way to get it here).
function ancestorIds(folders: Folder[], folderId: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const ids: string[] = [];
  let current = byId.get(folderId) ?? null;
  while (current?.parentFolderId) {
    ids.push(current.parentFolderId);
    current = byId.get(current.parentFolderId) ?? null;
  }
  return ids;
}

// ADR-0019 explorer redesign — a single-pane, file-explorer-style tree replacing the old
// always-on FolderBrowserRail. Fetches the whole (cheap, count-annotated) folder tree once, then
// lazily fetches + caches each folder's direct documents on first expand only, so re-expanding a
// folder is instant (see folder-tree.tsx's DocCacheEntry/onLoadMore wiring below).
export function FolderExplorer() {
  const t = useTranslations("folders");
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [breadcrumbFolderId, setBreadcrumbFolderId] = useState<string | null>(null);
  const [managingFolderId, setManagingFolderId] = useState<string | null>(null);
  const [managingTab, setManagingTab] = useState<"access" | "match" | null>(null);
  // Keyed by folder id, or UNFILED_KEY for the root "Unfiled" pseudo-node — populated on first
  // expand only (see ensureDocumentsLoaded below), so re-expanding an already-loaded folder never
  // re-fetches (ADR-0019's "instant once loaded once" requirement).
  const [docCache, setDocCacheState] = useState<Record<string, DocCacheEntry>>({});

  const load = useCallback(async () => {
    try {
      setFolders(await listFolderTreeAction());
    } catch {
      setFolders([]);
    }
  }, []);

  // Any folder mutation (move document, rename, delete, pattern save) changes what the per-folder
  // document caches should contain — drop them and immediately refetch whatever is currently
  // expanded, so an open folder never falls back to a stale list or a stuck "Loading…" row.
  function handleChanged() {
    const keys = [...expandedKeys];
    setDocCacheState({});
    void load();
    for (const key of keys) {
      fetchDocuments(key, key === UNFILED_KEY ? null : key);
    }
  }

  useEffect(() => {
    let cancelled = false;
    listFolderTreeAction()
      .then((data) => {
        if (!cancelled) setFolders(data);
      })
      .catch(() => {
        if (!cancelled) setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patchDocCache(key: string, entry: DocCacheEntry) {
    setDocCacheState((prev) => ({ ...prev, [key]: entry }));
  }

  // Fetches a folder's (or Unfiled's) first page of direct documents exactly once — a second
  // expand of an already-cached key is a no-op here, the instant re-expand ADR-0019 asks for.
  // Deliberately not a useCallback: it needs to see the current `docCache` state at click time,
  // and a memoized version keyed off a setState-updater closure raced the update (the updater
  // runs during React's render pass, after this function would already have decided to fetch).
  function ensureDocumentsLoaded(key: string, folderId: string | null) {
    if (docCache[key]) return;
    fetchDocuments(key, folderId);
  }

  // The uncached fetch itself — also called by handleChanged() to refresh folders that are
  // already expanded, bypassing the cache-hit guard above.
  function fetchDocuments(key: string, folderId: string | null) {
    patchDocCache(key, { items: [], page: 0, totalPages: 1, totalCount: 0, loading: true, error: null });

    listFolderDocumentsAction(folderId, { page: 1, pageSize: PAGE_SIZE })
      .then((result) => {
        patchDocCache(key, {
          items: result.items,
          page: result.page,
          totalPages: result.totalPages,
          totalCount: result.totalCount,
          loading: false,
          error: null
        });
      })
      .catch((err) => {
        patchDocCache(key, {
          items: [],
          page: 1,
          totalPages: 1,
          totalCount: 0,
          loading: false,
          error: err instanceof Error ? err.message : t("loadDocumentsFailed")
        });
      });
  }

  function handleToggle(key: string) {
    const next = new Set(expandedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      ensureDocumentsLoaded(key, key === UNFILED_KEY ? null : key);
      if (key !== UNFILED_KEY) setBreadcrumbFolderId(key);
    }
    setExpandedKeys(next);
  }

  function handleLoadMore(key: string) {
    const entry = docCache[key];
    if (!entry || entry.loading || entry.page >= entry.totalPages) return;
    patchDocCache(key, { ...entry, loading: true });
    const folderId = key === UNFILED_KEY ? null : key;
    listFolderDocumentsAction(folderId, { page: entry.page + 1, pageSize: PAGE_SIZE })
      .then((result) => {
        patchDocCache(key, {
          items: [...entry.items, ...result.items],
          page: result.page,
          totalPages: result.totalPages,
          totalCount: result.totalCount,
          loading: false,
          error: null
        });
      })
      .catch((err) => {
        patchDocCache(key, {
          ...entry,
          loading: false,
          error: err instanceof Error ? err.message : t("loadDocumentsFailed")
        });
      });
  }

  if (folders === null) {
    return <div className="rounded-lg border border-border bg-panel p-4 text-sm text-muted">{t("title")}…</div>;
  }

  const managingFolder = folders.find((f) => f.id === managingFolderId) ?? null;
  const breadcrumbFolder = breadcrumbFolderId ? (folders.find((f) => f.id === breadcrumbFolderId) ?? null) : null;
  const breadcrumbSegments = breadcrumbFolder ? breadcrumbFolder.path.split("/").filter(Boolean) : [];

  return (
    <div className="grid gap-3">
      {breadcrumbFolder ? (
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted">
          {breadcrumbSegments.map((segment, i) => (
            <span className="flex items-center gap-1" key={i}>
              {i > 0 ? <ChevronRight className="size-3" /> : null}
              {segment}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-panel p-2 shadow-sm">
        <FolderTree
          docCache={docCache}
          expandedKeys={expandedKeys}
          folders={folders}
          onChanged={handleChanged}
          onLoadMore={handleLoadMore}
          onManage={(folderId, tab) => {
            setManagingFolderId(folderId);
            setManagingTab(tab);
          }}
          onToggle={handleToggle}
        />
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setManagingFolderId(null);
            setManagingTab(null);
          }
        }}
        open={Boolean(managingFolder && managingTab)}
      >
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          {managingFolder && managingTab === "access" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("access.title", { name: managingFolder.name })}</DialogTitle>
              </DialogHeader>
              <FolderAccessManager
                ancestorFolderIds={ancestorIds(folders, managingFolder.id)}
                folder={managingFolder}
                key={managingFolder.id}
              />
            </>
          ) : null}
          {managingFolder && managingTab === "match" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("match.title", { name: managingFolder.name })}</DialogTitle>
              </DialogHeader>
              <FolderMatchEditor
                folder={managingFolder}
                key={`${managingFolder.id}:${JSON.stringify(managingFolder.matchConditions)}`}
                onSaved={handleChanged}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
