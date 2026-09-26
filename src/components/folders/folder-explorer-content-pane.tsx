"use client";

import { Folder as FolderIcon, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DocumentPermissionsTab } from "@/components/documents/document-permissions-tab";
import type { ContentItem } from "@/components/folders/folder-content-types";
import {
  DeleteFolderDialog,
  DeleteSelectionDialog,
  NewSubfolderDialog,
  RenameFolderDialog
} from "@/components/folders/folder-dialogs";
import { DOCUMENT_DRAG_MIME, FOLDER_DRAG_MIME, UNFILED_KEY, isDescendant, type FolderNode } from "@/components/folders/folder-dnd";
import { FolderBlankAreaContextMenu } from "@/components/folders/folder-item-context-menu";
import { FolderDetailsView } from "@/components/folders/folder-details-view";
import { FolderTilesView } from "@/components/folders/folder-tiles-view";
import { useFolderSelection } from "@/components/folders/use-folder-selection";
import { useFolderExplorerShortcuts } from "@/components/folders/use-folder-explorer-shortcuts";
import { cn } from "@/lib/utils";
import { deleteDocumentAction, updateDocumentAction } from "@/modules/documents/documents.actions";
import { getDocumentPermissionsAction } from "@/modules/documents/document-shares.actions";
import type { PermissionsResult } from "@/modules/documents/document-shares.service";
import type { Document } from "@/modules/documents/documents.service";
import { deleteFolderAction, moveDocumentsToFolderAction, moveFolderAction } from "@/modules/folders/folders.actions";
import type { Folder } from "@/modules/folders/folders.service";
import type { DocCacheEntry } from "@/components/folders/folder-explorer";

type CutClipboard = { kind: "folder"; folderId: string } | { kind: "documents"; documentIds: string[] } | null;

export function FolderExplorerContentPane({
  allFolders,
  currentFolderId,
  subfolders,
  docEntry,
  showUnfiledTile,
  viewMode,
  onNavigate,
  onLoadMore,
  onChanged,
  onManage,
  onSetViewMode,
  onRequestNewFolder
}: {
  allFolders: Folder[];
  currentFolderId: string | null;
  subfolders: FolderNode[];
  docEntry: DocCacheEntry | undefined;
  showUnfiledTile: boolean;
  viewMode: "tiles" | "details";
  onNavigate: (id: string | null) => void;
  onLoadMore: () => void;
  onChanged: () => void;
  onManage: (folderId: string, tab: "access" | "match") => void;
  onSetViewMode: (mode: "tiles" | "details") => void;
  onRequestNewFolder: () => void;
}) {
  const t = useTranslations("folders");
  const tDoc = useTranslations("documents.detail.actions");
  const router = useRouter();
  const selection = useFolderSelection();
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverUnfiled, setDragOverUnfiled] = useState(false);
  const [clipboard, setClipboard] = useState<CutClipboard>(null);
  const [isPending, startTransition] = useTransition();

  const [itemDialog, setItemDialog] = useState<
    { type: "rename" | "delete" | "newSubfolder"; folder: Folder } | null
  >(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);

  const [docDialog, setDocDialog] = useState<{ type: "rename" | "delete" | "permissions"; document: Document } | null>(
    null
  );
  const [docName, setDocName] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [docPermissions, setDocPermissions] = useState<Promise<PermissionsResult> | null>(null);

  const items: ContentItem[] = useMemo(() => {
    const folderItems: ContentItem[] = subfolders.map((f) => ({ kind: "folder", id: f.id, folder: f }));
    const docItems: ContentItem[] = (docEntry?.items ?? []).map((d) => ({ kind: "document", id: d.id, document: d }));
    return [...folderItems, ...docItems];
  }, [subfolders, docEntry]);

  const cutIds = useMemo(() => {
    if (!clipboard) return new Set<string>();
    return new Set(clipboard.kind === "folder" ? [clipboard.folderId] : clipboard.documentIds);
  }, [clipboard]);

  function openFolder(folder: FolderNode) {
    if (folder.accessLevel === "ancestor") {
      toast.error(t("cannotManageAncestor"));
      return;
    }
    onNavigate(folder.id);
  }

  function openItem(item: ContentItem) {
    if (item.kind === "folder") openFolder(item.folder);
    else router.push(`/dashboard/documents/${item.document.id}`);
  }

  function moveSelectionHere(targetFolderId: string | null) {
    if (!clipboard) return;
    startTransition(async () => {
      try {
        if (clipboard.kind === "folder") {
          if (targetFolderId && isDescendant(allFolders, targetFolderId, clipboard.folderId)) {
            toast.error(t("cannotMoveIntoDescendant"));
            return;
          }
          if (clipboard.folderId === targetFolderId) return;
          await moveFolderAction({ folderId: clipboard.folderId, newParentFolderId: targetFolderId });
        } else {
          const result = await moveDocumentsToFolderAction({ documentIds: clipboard.documentIds, folderId: targetFolderId });
          toast.success(t("documentsMoved", { count: result.movedCount }));
        }
        setClipboard(null);
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("moveFailed"));
      }
    });
  }

  function handleFolderDrop(folderId: string, event: React.DragEvent) {
    event.preventDefault();
    setDragOverFolderId(null);
    const target = subfolders.find((f) => f.id === folderId) ?? allFolders.find((f) => f.id === folderId);
    if (target?.accessLevel === "ancestor") {
      toast.error(t("cannotManageAncestor"));
      return;
    }
    const draggedFolderId = event.dataTransfer.getData(FOLDER_DRAG_MIME);
    const draggedDocumentIds = event.dataTransfer.getData(DOCUMENT_DRAG_MIME);

    if (draggedFolderId) {
      if (draggedFolderId === folderId) return;
      if (isDescendant(allFolders, folderId, draggedFolderId)) {
        toast.error(t("cannotMoveIntoDescendant"));
        return;
      }
      startTransition(async () => {
        try {
          await moveFolderAction({ folderId: draggedFolderId, newParentFolderId: folderId });
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("moveFailed"));
        }
      });
      return;
    }

    if (draggedDocumentIds) {
      const documentIds = JSON.parse(draggedDocumentIds) as string[];
      if (documentIds.length === 0) return;
      startTransition(async () => {
        try {
          const result = await moveDocumentsToFolderAction({ documentIds, folderId });
          toast.success(t("documentsMoved", { count: result.movedCount }));
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("moveFailed"));
        }
      });
    }
  }

  function handleUnfiledDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOverUnfiled(false);
    const draggedDocumentIds = event.dataTransfer.getData(DOCUMENT_DRAG_MIME);
    if (!draggedDocumentIds) return;
    const documentIds = JSON.parse(draggedDocumentIds) as string[];
    if (documentIds.length === 0) return;
    startTransition(async () => {
      try {
        const result = await moveDocumentsToFolderAction({ documentIds, folderId: null });
        toast.success(t("documentsMoved", { count: result.movedCount }));
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("moveFailed"));
      }
    });
  }

  function bulkDelete() {
    setBulkDeletePending(true);
    void (async () => {
      try {
        for (const id of selection.selectedIds) {
          const item = items.find((i) => i.id === id);
          if (!item) continue;
          if (item.kind === "folder") await deleteFolderAction({ folderId: item.id, mode: "require_empty" });
          else await deleteDocumentAction(item.id);
        }
        toast.success(t("bulkDeleted", { count: selection.selectedIds.size }));
        setBulkDeleteOpen(false);
        selection.clear();
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("deleteFailed"));
      } finally {
        setBulkDeletePending(false);
      }
    })();
  }

  function bulkCut() {
    const selectedItems = items.filter((i) => selection.isSelected(i.id));
    const folderItem = selectedItems.find((i) => i.kind === "folder");
    if (folderItem && folderItem.kind === "folder") {
      setClipboard({ kind: "folder", folderId: folderItem.folder.id });
    } else {
      setClipboard({ kind: "documents", documentIds: selectedItems.map((i) => i.id) });
    }
  }

  const shortcuts = useFolderExplorerShortcuts({
    items,
    selectedIds: selection.selectedIds,
    isSelected: selection.isSelected,
    selectOnly: selection.selectOnly,
    selectRange: selection.selectRange,
    selectAll: selection.selectAll,
    clearSelection: selection.clear,
    handlers: {
      onOpen: (id) => {
        const item = items.find((i) => i.id === id);
        if (item) openItem(item);
      },
      onRename: (id) => {
        const item = items.find((i) => i.id === id);
        if (!item) return;
        if (item.kind === "folder") setItemDialog({ type: "rename", folder: item.folder });
        else {
          setDocName(item.document.title);
          setDocError(null);
          setDocDialog({ type: "rename", document: item.document });
        }
      },
      onDelete: (ids) => {
        if (ids.length === 1) {
          const item = items.find((i) => i.id === ids[0]);
          if (item?.kind === "folder") {
            setItemDialog({ type: "delete", folder: item.folder });
            return;
          }
          if (item?.kind === "document") {
            setDocDialog({ type: "delete", document: item.document });
            return;
          }
        }
        setBulkDeleteOpen(true);
      },
      onCut: bulkCut,
      onPaste: () => (clipboard ? moveSelectionHere(currentFolderId === UNFILED_KEY ? null : currentFolderId) : undefined)
    }
  });

  function folderMenuActions(node: FolderNode) {
    return {
      onOpen: () => openFolder(node),
      onNewSubfolder: () => setItemDialog({ type: "newSubfolder", folder: node }),
      onRename: node.accessLevel === "ancestor" ? undefined : () => setItemDialog({ type: "rename", folder: node }),
      onManageAccess: node.accessLevel === "ancestor" ? undefined : () => onManage(node.id, "access"),
      onManageMatch: node.accessLevel === "ancestor" ? undefined : () => onManage(node.id, "match"),
      onCut: node.accessLevel === "ancestor" ? undefined : () => setClipboard({ kind: "folder", folderId: node.id }),
      onDelete: () => setItemDialog({ type: "delete", folder: node })
    };
  }

  function documentMenuActions(document: Document) {
    return {
      onOpen: () => router.push(`/dashboard/documents/${document.id}`),
      onDownload: () => window.open(`/api/documents/${document.id}/download`, "_blank"),
      onRename: () => {
        setDocName(document.title);
        setDocError(null);
        setDocDialog({ type: "rename", document });
      },
      onPermissions: () => {
        setDocPermissions(getDocumentPermissionsAction(document.id));
        setDocDialog({ type: "permissions", document });
      },
      onCut: () => setClipboard({ kind: "documents", documentIds: [document.id] }),
      onDelete: () => setDocDialog({ type: "delete", document })
    };
  }

  function submitDocRename() {
    if (!docDialog || docDialog.type !== "rename") return;
    startTransition(async () => {
      try {
        await updateDocumentAction(docDialog.document.id, { title: docName.trim() });
        toast.success(tDoc("renamed"));
        setDocDialog(null);
        onChanged();
      } catch (err) {
        setDocError(err instanceof Error ? err.message : tDoc("renameFailed"));
      }
    });
  }

  function submitDocDelete() {
    if (!docDialog || docDialog.type !== "delete") return;
    startTransition(async () => {
      try {
        await deleteDocumentAction(docDialog.document.id);
        setDocDialog(null);
        onChanged();
      } catch (err) {
        setDocError(err instanceof Error ? err.message : tDoc("deleteFailed"));
      }
    });
  }

  const bag = {
    items,
    isSelected: selection.isSelected,
    focusedId: shortcuts.focusedId,
    cutIds,
    dragOverFolderId,
    onItemMouseDown: (item: ContentItem, event: React.MouseEvent) => {
      event.stopPropagation();
      if (event.shiftKey) selection.selectRange(items, item.id);
      else if (event.metaKey || event.ctrlKey) selection.toggle(item);
      else selection.selectOnly(item);
      shortcuts.setFocusedId(item.id);
    },
    onItemOpen: openItem,
    onItemDragStart: (item: ContentItem, event: React.DragEvent) => {
      if (item.kind === "folder") {
        if (item.folder.accessLevel === "ancestor") {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(FOLDER_DRAG_MIME, item.id);
        event.dataTransfer.effectAllowed = "move";
        return;
      }
      const selectedDocIds = items
        .filter((i) => i.kind === "document" && selection.isSelected(i.id))
        .map((i) => i.id);
      const hasSelectedFolder = items.some((i) => i.kind === "folder" && selection.isSelected(i.id));
      const ids = selection.isSelected(item.id) && !hasSelectedFolder && selectedDocIds.length > 1 ? selectedDocIds : [item.id];
      event.dataTransfer.setData(DOCUMENT_DRAG_MIME, JSON.stringify(ids));
      event.dataTransfer.effectAllowed = "move";
    },
    onFolderDragOver: (folderId: string, event: React.DragEvent) => {
      const target = subfolders.find((f) => f.id === folderId);
      if (target?.accessLevel === "ancestor") return;
      if (event.dataTransfer.types.includes(FOLDER_DRAG_MIME) || event.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) {
        event.preventDefault();
        setDragOverFolderId(folderId);
      }
    },
    onFolderDragLeave: () => setDragOverFolderId(null),
    onFolderDrop: handleFolderDrop,
    folderMenuActions,
    documentMenuActions,
    onBulkDelete: () => setBulkDeleteOpen(true),
    onBulkCut: bulkCut,
    onChanged
  };

  const ViewComponent = viewMode === "details" ? FolderDetailsView : FolderTilesView;

  return (
    <div
      className="min-h-96 rounded-lg border border-border bg-panel p-3 shadow-sm outline-none"
      data-testid="folder-content-pane"
      onClick={() => selection.clear()}
      onKeyDown={shortcuts.onKeyDown}
      tabIndex={0}
    >
      {selection.selectedIds.size > 0 ? (
        <div
          className="mb-3 flex items-center justify-between gap-2 rounded-md bg-panel-strong px-3 py-1.5 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-muted">{t("selectedCount", { count: selection.selectedIds.size })}</span>
          <div className="flex items-center gap-1">
            <Button onClick={() => setBulkDeleteOpen(true)} size="sm" variant="outline">
              <Trash2 className="size-4" /> {t("delete")}
            </Button>
            <Button onClick={() => selection.clear()} size="icon" variant="ghost">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
      <FolderBlankAreaContextMenu
        canPaste={Boolean(clipboard) && currentFolderId !== null}
        onNewFolder={onRequestNewFolder}
        onPaste={() => moveSelectionHere(currentFolderId === UNFILED_KEY ? null : currentFolderId)}
        onSetViewMode={onSetViewMode}
        viewMode={viewMode}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <ViewComponent {...bag} />

          {showUnfiledTile ? (
            <div
              className={cn(
                "mt-2 flex w-fit cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-border p-3 text-center hover:bg-panel-strong/60",
                dragOverUnfiled && "ring-2 ring-ring"
              )}
              onClick={() => onNavigate(UNFILED_KEY)}
              onDragLeave={() => setDragOverUnfiled(false)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) {
                  e.preventDefault();
                  setDragOverUnfiled(true);
                }
              }}
              onDrop={handleUnfiledDrop}
              role="button"
              tabIndex={0}
            >
              <FolderIcon className="size-12 text-muted" />
              <span className="text-sm">{t("unfiled")}</span>
            </div>
          ) : null}

          {docEntry && !docEntry.loading && docEntry.page < docEntry.totalPages ? (
            <div className="mt-3">
              <button
                className="text-xs text-muted underline underline-offset-2 hover:text-foreground"
                onClick={onLoadMore}
                type="button"
              >
                {t("loadMore")}
              </button>
            </div>
          ) : null}
          {docEntry?.loading ? <p className="mt-3 text-xs text-muted">{t("loadingDocuments")}</p> : null}
          {docEntry?.error ? <p className="mt-3 text-xs text-danger">{docEntry.error}</p> : null}
        </div>
      </FolderBlankAreaContextMenu>

      {itemDialog?.type === "rename" ? (
        <RenameFolderDialog
          folder={itemDialog.folder}
          onOpenChange={(open) => !open && setItemDialog(null)}
          onRenamed={() => {
            setItemDialog(null);
            onChanged();
          }}
          open
        />
      ) : null}
      {itemDialog?.type === "newSubfolder" ? (
        <NewSubfolderDialog
          onCreated={() => {
            setItemDialog(null);
            onChanged();
          }}
          onOpenChange={(open) => !open && setItemDialog(null)}
          open
          parentFolderId={itemDialog.folder.id}
        />
      ) : null}
      {itemDialog?.type === "delete" ? (
        <DeleteFolderDialog
          folder={itemDialog.folder}
          hasChildren={(itemDialog.folder.childFolderCount ?? 0) > 0}
          onDeleted={() => {
            setItemDialog(null);
            onChanged();
          }}
          onOpenChange={(open) => !open && setItemDialog(null)}
          open
        />
      ) : null}

      <DeleteSelectionDialog
        count={selection.selectedIds.size}
        isPending={bulkDeletePending}
        onConfirm={bulkDelete}
        onOpenChange={setBulkDeleteOpen}
        open={bulkDeleteOpen}
      />

      <Dialog onOpenChange={(open) => !open && setDocDialog(null)} open={docDialog?.type === "rename"}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tDoc("renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            onChange={(e) => setDocName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && docName.trim() && submitDocRename()}
            placeholder={tDoc("renamePlaceholder")}
            value={docName}
          />
          {docError ? <p className="text-sm text-danger">{docError}</p> : null}
          <DialogFooter>
            <Button onClick={() => setDocDialog(null)} type="button" variant="outline">
              {tDoc("cancel")}
            </Button>
            <Button disabled={isPending || !docName.trim()} onClick={submitDocRename} type="button">
              {tDoc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setDocDialog(null)} open={docDialog?.type === "delete"}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tDoc("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>{tDoc("deleteConfirmDescription")}</DialogDescription>
          </DialogHeader>
          {docError ? <p className="text-sm text-danger">{docError}</p> : null}
          <DialogFooter>
            <Button onClick={() => setDocDialog(null)} type="button" variant="outline">
              {tDoc("cancel")}
            </Button>
            <Button disabled={isPending} onClick={submitDocDelete} type="button">
              {tDoc("deleteConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setDocDialog(null)} open={docDialog?.type === "permissions"}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{docDialog?.document.title}</DialogTitle>
          </DialogHeader>
          {docDialog && docPermissions ? (
            <DocumentPermissionsTab documentId={docDialog.document.id} permissions={docPermissions} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
