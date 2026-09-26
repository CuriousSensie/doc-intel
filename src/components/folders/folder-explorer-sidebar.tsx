"use client";

import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderPlus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { NewSubfolderDialog } from "@/components/folders/folder-dialogs";
import { DOCUMENT_DRAG_MIME, FOLDER_DRAG_MIME, UNFILED_KEY, buildTree, isDescendant, type FolderNode } from "@/components/folders/folder-dnd";
import { cn } from "@/lib/utils";
import { moveDocumentsToFolderAction, moveFolderAction } from "@/modules/folders/folders.actions";
import type { Folder } from "@/modules/folders/folders.service";

function SidebarNode({
  node,
  depth,
  allFolders,
  currentFolderId,
  expandedIds,
  onToggle,
  onNavigate,
  onChanged
}: {
  node: FolderNode;
  depth: number;
  allFolders: Folder[];
  currentFolderId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("folders");
  const [isPending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const isAncestorOnly = node.accessLevel === "ancestor";
  const expanded = expandedIds.has(node.id);
  const isCurrent = currentFolderId === node.id;
  const canExpand = node.children.length > 0;

  function handleDragOver(e: React.DragEvent) {
    if (isAncestorOnly) return;
    if (e.dataTransfer.types.includes(FOLDER_DRAG_MIME) || e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) {
      e.preventDefault();
      setDragOver(true);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (isAncestorOnly) {
      toast.error(t("cannotManageAncestor"));
      return;
    }
    const draggedFolderId = e.dataTransfer.getData(FOLDER_DRAG_MIME);
    const draggedDocumentIds = e.dataTransfer.getData(DOCUMENT_DRAG_MIME);

    if (draggedFolderId) {
      if (draggedFolderId === node.id) return;
      if (isDescendant(allFolders, node.id, draggedFolderId)) {
        toast.error(t("cannotMoveIntoDescendant"));
        return;
      }
      startTransition(async () => {
        try {
          await moveFolderAction({ folderId: draggedFolderId, newParentFolderId: node.id });
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
          const result = await moveDocumentsToFolderAction({ documentIds, folderId: node.id });
          toast.success(t("documentsMoved", { count: result.movedCount }));
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("moveFailed"));
        }
      });
    }
  }

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm",
          isAncestorOnly ? "text-muted opacity-60" : "cursor-pointer hover:bg-panel-strong/60",
          isCurrent && "bg-panel-strong font-medium text-foreground",
          dragOver && "ring-2 ring-ring",
          isPending && "opacity-60"
        )}
        draggable={!isAncestorOnly}
        onDragLeave={() => setDragOver(false)}
        onDragOver={handleDragOver}
        onDragStart={(e) => {
          if (isAncestorOnly) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(FOLDER_DRAG_MIME, node.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDrop={handleDrop}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          aria-label={expanded ? t("collapse") : t("expand")}
          className="flex size-5 shrink-0 items-center justify-center text-muted"
          disabled={!canExpand}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id);
          }}
          type="button"
        >
          {canExpand ? expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" /> : null}
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
          onClick={() => {
            if (isAncestorOnly) {
              toast.error(t("cannotManageAncestor"));
              return;
            }
            onNavigate(node.id);
          }}
          type="button"
        >
          <FolderIcon className="size-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {expanded && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <SidebarNode
              allFolders={allFolders}
              currentFolderId={currentFolderId}
              depth={depth + 1}
              expandedIds={expandedIds}
              key={child.id}
              node={child}
              onChanged={onChanged}
              onNavigate={onNavigate}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderExplorerSidebar({
  folders,
  currentFolderId,
  expandedIds,
  collapsed,
  onToggleCollapsed,
  onToggleExpand,
  onNavigate,
  onChanged
}: {
  folders: Folder[];
  currentFolderId: string | null;
  expandedIds: Set<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleExpand: (id: string) => void;
  onNavigate: (id: string | null) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("folders");
  const [newRootOpen, setNewRootOpen] = useState(false);
  const [unfiledDragOver, setUnfiledDragOver] = useState(false);
  const [, startTransition] = useTransition();
  const tree = useMemo(() => buildTree(folders), [folders]);

  function handleUnfiledDrop(e: React.DragEvent) {
    e.preventDefault();
    setUnfiledDragOver(false);
    const draggedDocumentIds = e.dataTransfer.getData(DOCUMENT_DRAG_MIME);
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

  if (collapsed) {
    return (
      <div className="flex h-fit flex-col items-center gap-2 rounded-lg border border-border bg-panel p-2 shadow-sm">
        <button
          aria-label={t("expandSidebar")}
          className="flex size-8 items-center justify-center rounded text-muted hover:bg-panel-strong"
          onClick={onToggleCollapsed}
          type="button"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <nav
      aria-label={t("title")}
      className="grid w-56 shrink-0 content-start gap-1 self-start rounded-lg border border-border bg-panel p-2 shadow-sm"
    >
      <div className="mb-1 flex items-center justify-between px-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("title")}</h2>
        <div className="flex items-center gap-0.5">
          <button
            aria-label={t("newFolderTitle")}
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-panel-strong"
            onClick={() => setNewRootOpen(true)}
            type="button"
          >
            <FolderPlus className="size-4" />
          </button>
          <button
            aria-label={t("collapseSidebar")}
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-panel-strong"
            onClick={onToggleCollapsed}
            type="button"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
      </div>

      <ul>
        <li>
          <button
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-panel-strong/60",
              currentFolderId === null && "bg-panel-strong font-medium text-foreground"
            )}
            onClick={() => onNavigate(null)}
            type="button"
          >
            {t("allFolders")}
          </button>
        </li>
        {tree.map((node) => (
          <SidebarNode
            allFolders={folders}
            currentFolderId={currentFolderId}
            depth={0}
            expandedIds={expandedIds}
            key={node.id}
            node={node}
            onChanged={onChanged}
            onNavigate={(id) => onNavigate(id)}
            onToggle={onToggleExpand}
          />
        ))}
        <li>
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-md px-1.5 py-1 pl-[4px] text-sm hover:bg-panel-strong/60",
              currentFolderId === UNFILED_KEY && "bg-panel-strong font-medium text-foreground",
              unfiledDragOver && "ring-2 ring-ring"
            )}
            onDragLeave={() => setUnfiledDragOver(false)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) {
                e.preventDefault();
                setUnfiledDragOver(true);
              }
            }}
            onDrop={handleUnfiledDrop}
          >
            <button
              className="flex w-full items-center gap-1.5 text-left"
              onClick={() => onNavigate(UNFILED_KEY)}
              type="button"
            >
              <FolderIcon className="size-3.5 shrink-0" />
              <span className="truncate">{t("unfiled")}</span>
            </button>
          </div>
        </li>
      </ul>

      <NewSubfolderDialog onCreated={onChanged} onOpenChange={setNewRootOpen} open={newRootOpen} parentFolderId={null} />
    </nav>
  );
}
