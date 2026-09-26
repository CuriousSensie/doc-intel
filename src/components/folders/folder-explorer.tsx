"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FolderAccessManager } from "@/components/folders/folder-access-manager";
import { FolderMatchEditor } from "@/components/folders/folder-match-editor";
import { FolderExplorerContentPane } from "@/components/folders/folder-explorer-content-pane";
import { FolderExplorerSidebar } from "@/components/folders/folder-explorer-sidebar";
import { FolderExplorerSkeleton } from "@/components/folders/folder-explorer-skeleton";
import { FolderExplorerToolbar } from "@/components/folders/folder-explorer-toolbar";
import { NewSubfolderDialog } from "@/components/folders/folder-dialogs";
import { UNFILED_KEY, ancestorIds, buildTree } from "@/components/folders/folder-dnd";
import { listFolderDocumentsAction, listFolderTreeAction } from "@/modules/folders/folders.actions";
import type { DocumentPageSize } from "@/modules/documents/documents.service";
import type { Document } from "@/modules/documents/documents.service";
import type { Folder } from "@/modules/folders/folders.service";

const PAGE_SIZE: DocumentPageSize = 25;

export type DocCacheEntry = {
  items: Document[];
  page: number;
  totalPages: number;
  totalCount: number;
  loading: boolean;
  error: string | null;
};

// Explorer-style redesign (docs/adr/0019-folders.md amendment: folders stay a top-level
// destination on this one route). "Current folder" is a `?folderId=` query param — a real uuid,
// the UNFILED_KEY sentinel, or absent for the root view — so drilling into a folder gets real
// back/forward and shareable links without ever needing a nested `/folders/[id]` route.
export function FolderExplorer() {
  const t = useTranslations("folders");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [docCache, setDocCacheState] = useState<Record<string, DocCacheEntry>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState<Set<string>>(new Set());
  const [managingFolderId, setManagingFolderId] = useState<string | null>(null);
  const [managingTab, setManagingTab] = useState<"access" | "match" | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const currentFolderId = searchParams.get("folderId");
  const viewMode = searchParams.get("fv") === "details" ? "details" : "tiles";
  const currentKey = currentFolderId ?? null;

  const load = useCallback(async () => {
    try {
      setFolders(await listFolderTreeAction());
    } catch {
      setFolders([]);
    }
  }, []);

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

  const fetchDocuments = useCallback((key: string, folderId: string | null) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever the open folder changes (drill-in, breadcrumb, sidebar, back/forward), make sure its
  // documents are loaded — once loaded, re-visiting the same key is instant (ADR-0019).
  useEffect(() => {
    if (!currentKey) return;
    const realFolderId = currentKey === UNFILED_KEY ? null : currentKey;
    if (docCache[currentKey]) return;
    fetchDocuments(currentKey, realFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  // Auto-expand the sidebar's ancestor chain of whatever folder is currently open.
  useEffect(() => {
    if (!folders || !currentFolderId || currentFolderId === UNFILED_KEY) return;
    const ids = ancestorIds(folders, currentFolderId);
    if (ids.length === 0) return;
    setSidebarExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, [folders, currentFolderId]);

  function handleChanged() {
    void load();
    if (currentKey) {
      const realFolderId = currentKey === UNFILED_KEY ? null : currentKey;
      fetchDocuments(currentKey, realFolderId);
    }
  }

  function handleLoadMore() {
    if (!currentKey) return;
    const entry = docCache[currentKey];
    if (!entry || entry.loading || entry.page >= entry.totalPages) return;
    patchDocCache(currentKey, { ...entry, loading: true });
    const realFolderId = currentKey === UNFILED_KEY ? null : currentKey;
    listFolderDocumentsAction(realFolderId, { page: entry.page + 1, pageSize: PAGE_SIZE })
      .then((result) => {
        patchDocCache(currentKey, {
          items: [...entry.items, ...result.items],
          page: result.page,
          totalPages: result.totalPages,
          totalCount: result.totalCount,
          loading: false,
          error: null
        });
      })
      .catch((err) => {
        patchDocCache(currentKey, {
          ...entry,
          loading: false,
          error: err instanceof Error ? err.message : t("loadDocumentsFailed")
        });
      });
  }

  function navigateToFolder(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("folderId", id);
    else params.delete("folderId");
    router.push(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }

  function setViewMode(mode: "tiles" | "details") {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "details") params.set("fv", "details");
    else params.delete("fv");
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }

  function toggleSidebarExpand(id: string) {
    setSidebarExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (folders === null) {
    return <FolderExplorerSkeleton />;
  }

  const tree = buildTree(folders);
  const currentFolder = currentFolderId && currentFolderId !== UNFILED_KEY ? (folders.find((f) => f.id === currentFolderId) ?? null) : null;
  const subfolders =
    currentFolderId === UNFILED_KEY
      ? []
      : currentFolder
        ? tree.flatMap(function findChildren(node): typeof tree {
            if (node.id === currentFolder.id) return node.children;
            return node.children.flatMap(findChildren);
          })
        : tree;
  const docEntry = currentKey ? docCache[currentKey] : undefined;
  const showUnfiledTile = currentFolderId === null;
  const managingFolder = folders.find((f) => f.id === managingFolderId) ?? null;
  const newFolderParentId = currentFolder && currentFolder.accessLevel !== "ancestor" ? currentFolder.id : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 items-stretch gap-4">
      <FolderExplorerSidebar
        collapsed={sidebarCollapsed}
        currentFolderId={currentFolderId}
        expandedIds={sidebarExpanded}
        folders={folders}
        onChanged={handleChanged}
        onNavigate={navigateToFolder}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        onToggleExpand={toggleSidebarExpand}
      />

      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_1fr] gap-3">
        <FolderExplorerToolbar
          currentFolderId={currentFolderId}
          folders={folders}
          onNavigate={navigateToFolder}
          onNewFolder={() => setNewFolderOpen(true)}
          onSetViewMode={setViewMode}
          viewMode={viewMode}
        />

        <FolderExplorerContentPane
          allFolders={folders}
          currentFolderId={currentFolderId}
          docEntry={docEntry}
          onChanged={handleChanged}
          onLoadMore={handleLoadMore}
          onManage={(folderId, tab) => {
            setManagingFolderId(folderId);
            setManagingTab(tab);
          }}
          onNavigate={navigateToFolder}
          onRequestNewFolder={() => setNewFolderOpen(true)}
          onSetViewMode={setViewMode}
          showUnfiledTile={showUnfiledTile}
          subfolders={subfolders}
          viewMode={viewMode}
        />
      </div>

      <NewSubfolderDialog
        onCreated={handleChanged}
        onOpenChange={setNewFolderOpen}
        open={newFolderOpen}
        parentFolderId={newFolderParentId}
      />

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
