"use client";

import { FileText, Folder as FolderIcon, MoreHorizontal, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { DocumentActionsMenu } from "@/components/documents/document-actions-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { ContentPaneBag } from "@/components/folders/folder-content-types";
import { FolderBulkContextMenu, FolderItemContextMenu } from "@/components/folders/folder-item-context-menu";
import { cn } from "@/lib/utils";

// The extra props ContextMenuTrigger's `asChild` Slot merges onto FolderTile/DocumentTile
// (onContextMenu, style, data-state/data-disabled) — excludes the handlers these components
// already declare explicitly with their own (differently-typed) signatures, so the two prop sets
// never conflict.
type TileRestProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onClick" | "onDoubleClick" | "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop" | "children"
>;

// Large-icon grid — folders and documents as tiles, same responsive columns as
// document-small-cards-view.tsx's grid for visual consistency across the app.
export function FolderTilesView(bag: ContentPaneBag) {
  const t = useTranslations("folders");

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {bag.items.map((item) => {
        const selected = bag.isSelected(item.id);
        const isCut = bag.cutIds.has(item.id);
        const bulkMode = selected && bag.items.filter((i) => bag.isSelected(i.id)).length > 1;

        const tile =
          item.kind === "folder" ? (
            <FolderTile bag={bag} focused={bag.focusedId === item.id} isCut={isCut} node={item.folder} selected={selected} />
          ) : (
            <DocumentTile
              bag={bag}
              document={item.document}
              focused={bag.focusedId === item.id}
              isCut={isCut}
              selected={selected}
            />
          );

        if (bulkMode) {
          return (
            <FolderBulkContextMenu
              canCut
              count={bag.items.filter((i) => bag.isSelected(i.id)).length}
              key={item.id}
              onCut={bag.onBulkCut}
              onDelete={bag.onBulkDelete}
            >
              {tile}
            </FolderBulkContextMenu>
          );
        }

        return (
          <FolderItemContextMenu
            disabled={item.kind === "folder" && item.folder.accessLevel === "ancestor"}
            documentActions={item.kind === "document" ? bag.documentMenuActions(item.document) : undefined}
            folderActions={item.kind === "folder" ? bag.folderMenuActions(item.folder) : undefined}
            key={item.id}
            kind={item.kind}
          >
            {tile}
          </FolderItemContextMenu>
        );
      })}
      {bag.items.length === 0 ? <p className="col-span-full py-8 text-center text-sm text-muted">{t("noDocuments")}</p> : null}
    </div>
  );
}

// `...rest` exists solely to receive whatever ContextMenuTrigger's `asChild` Slot merges onto
// this element (onContextMenu, style, data-state/data-disabled) — FolderTile/DocumentTile sit
// between the Slot and this div, and since they're plain components with a fixed prop list (not
// `...props`-spreading passthroughs), those injected props would otherwise be silently dropped
// before ever reaching a real DOM node, and the item's own right-click menu would never open.
function TileShell({
  children,
  selected,
  focused,
  isCut,
  dragOver,
  draggable,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  ...rest
}: {
  children: React.ReactNode;
  selected: boolean;
  focused: boolean;
  isCut: boolean;
  dragOver?: boolean;
  draggable: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-lg border border-transparent p-3 text-center hover:bg-panel-strong/60",
        selected && "border-border bg-panel-strong",
        focused && "ring-2 ring-ring",
        dragOver && "ring-2 ring-ring",
        isCut && "opacity-50"
      )}
      data-selected={selected}
      draggable={draggable}
      onClick={onClick}
      onContextMenu={(e) => {
        // Stop the native event from also reaching the content pane's blank-area context menu
        // (whose trigger wraps this whole grid) once this item's own menu has been asked to open.
        e.stopPropagation();
        rest.onContextMenu?.(e);
      }}
      onDoubleClick={onDoubleClick}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

function FolderTile({
  bag,
  node,
  selected,
  focused,
  isCut,
  ...rest
}: {
  bag: ContentPaneBag;
  node: import("@/components/folders/folder-dnd").FolderNode;
  selected: boolean;
  focused: boolean;
  isCut: boolean;
} & TileRestProps) {
  const t = useTranslations("folders");
  const isAncestorOnly = node.accessLevel === "ancestor";
  const item = { kind: "folder" as const, id: node.id, folder: node };
  const countsLabel = t("counts", { folders: node.childFolderCount ?? 0, documents: node.documentCount ?? 0 });

  return (
    <TileShell
      {...rest}
      draggable={!isAncestorOnly}
      dragOver={bag.dragOverFolderId === node.id}
      focused={focused}
      isCut={isCut}
      onClick={(e) => bag.onItemMouseDown(item, e)}
      onDoubleClick={() => bag.onItemOpen(item)}
      onDragLeave={bag.onFolderDragLeave}
      onDragOver={(e) => bag.onFolderDragOver(node.id, e)}
      onDragStart={(e) => bag.onItemDragStart(item, e)}
      onDrop={(e) => bag.onFolderDrop(node.id, e)}
      selected={selected}
    >
      <div className="relative">
        <FolderIcon className={cn("size-12", isAncestorOnly ? "text-muted opacity-60" : "text-accent")} />
        {node.matchConditions ? (
          <span className="absolute -right-1 -top-1" title={t("hasMatchPattern")}>
            <Sparkles className="size-3.5 text-muted" />
          </span>
        ) : null}
      </div>
      <span className={cn("w-full truncate text-sm", isAncestorOnly && "text-muted opacity-60")}>{node.name}</span>
      <span className="text-xs text-muted">{countsLabel}</span>
      {!isAncestorOnly ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t("folderActions")}
              className="absolute right-1 top-1 flex size-6 items-center justify-center rounded text-muted opacity-0 hover:bg-panel group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
              type="button"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => bag.folderMenuActions(node).onNewSubfolder?.()}>
              {t("newSubfolder")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => bag.folderMenuActions(node).onRename?.()}>{t("rename")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => bag.folderMenuActions(node).onManageAccess?.()}>
              {t("manageAccess")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => bag.folderMenuActions(node).onManageMatch?.()}>
              {t("manageMatch")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-danger" onSelect={() => bag.folderMenuActions(node).onDelete()}>
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </TileShell>
  );
}

function DocumentTile({
  bag,
  document,
  selected,
  focused,
  isCut,
  ...rest
}: {
  bag: ContentPaneBag;
  document: import("@/modules/documents/documents.service").Document;
  selected: boolean;
  focused: boolean;
  isCut: boolean;
} & TileRestProps) {
  const item = { kind: "document" as const, id: document.id, document };

  return (
    <TileShell
      {...rest}
      draggable
      focused={focused}
      isCut={isCut}
      onClick={(e) => bag.onItemMouseDown(item, e)}
      onDoubleClick={() => bag.onItemOpen(item)}
      onDragStart={(e) => bag.onItemDragStart(item, e)}
      selected={selected}
    >
      <FileText className="size-12 text-muted" />
      <span className="w-full truncate text-sm">{document.title}</span>
      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <DocumentActionsMenu
          detailHref={`/dashboard/documents/${document.id}`}
          documentId={document.id}
          onChanged={bag.onChanged}
          title={document.title}
        />
      </div>
    </TileShell>
  );
}
