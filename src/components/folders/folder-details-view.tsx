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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContentPaneBag } from "@/components/folders/folder-content-types";
import { FolderBulkContextMenu, FolderItemContextMenu } from "@/components/folders/folder-item-context-menu";
import { cn } from "@/lib/utils";

// Details/list view — same items as the tiles view, rendered as a table (name/type/count-or-size/
// actions), for users who want a denser, sortable-by-eye listing rather than icon tiles.
export function FolderDetailsView(bag: ContentPaneBag) {
  const t = useTranslations("folders");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead>{t("type")}</TableHead>
          <TableHead>{t("itemCount")}</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {bag.items.length === 0 ? (
          <TableRow>
            <TableCell className="py-8 text-center text-sm text-muted" colSpan={4}>
              {t("noDocuments")}
            </TableCell>
          </TableRow>
        ) : null}
        {bag.items.map((item) => {
          const selected = bag.isSelected(item.id);
          const isCut = bag.cutIds.has(item.id);
          const bulkMode = selected && bag.items.filter((i) => bag.isSelected(i.id)).length > 1;

          const row =
            item.kind === "folder" ? (
              <FolderRow bag={bag} focused={bag.focusedId === item.id} isCut={isCut} node={item.folder} selected={selected} />
            ) : (
              <DocumentRow
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
                {row}
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
              {row}
            </FolderItemContextMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

// `...rest` receives whatever ContextMenuTrigger's `asChild` Slot merges onto this element
// (onContextMenu, style, data-state/data-disabled) — FolderRow sits between the Slot and the real
// `<tr>`, and since it's a plain component with a fixed prop list, those injected props would
// otherwise be silently dropped before ever reaching a real DOM node, and the row's own right-click
// menu would never open.
function FolderRow({
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
} & React.HTMLAttributes<HTMLTableRowElement>) {
  const t = useTranslations("folders");
  const isAncestorOnly = node.accessLevel === "ancestor";
  const item = { kind: "folder" as const, id: node.id, folder: node };
  const countsLabel = t("counts", { folders: node.childFolderCount ?? 0, documents: node.documentCount ?? 0 });

  return (
    <TableRow
      {...rest}
      className={cn(
        "group cursor-pointer",
        selected && "bg-panel-strong",
        focused && "ring-2 ring-inset ring-ring",
        bag.dragOverFolderId === node.id && "ring-2 ring-inset ring-ring",
        isCut && "opacity-50"
      )}
      data-selected={selected}
      draggable={!isAncestorOnly}
      onClick={(e) => bag.onItemMouseDown(item, e)}
      onContextMenu={(e) => {
        // Stop the native event from also reaching the content pane's blank-area context menu
        // (whose trigger wraps the whole table) once this row's own menu has been asked to open.
        e.stopPropagation();
        rest.onContextMenu?.(e);
      }}
      onDoubleClick={() => bag.onItemOpen(item)}
      onDragLeave={bag.onFolderDragLeave}
      onDragOver={(e) => bag.onFolderDragOver(node.id, e)}
      onDragStart={(e) => bag.onItemDragStart(item, e)}
      onDrop={(e) => bag.onFolderDrop(node.id, e)}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <FolderIcon className={cn("size-4 shrink-0", isAncestorOnly ? "text-muted opacity-60" : "text-accent")} />
          <span className={cn("truncate", isAncestorOnly && "text-muted opacity-60")}>{node.name}</span>
          {node.matchConditions ? (
            <span title={t("hasMatchPattern")}>
              <Sparkles className="size-3.5 shrink-0 text-muted" />
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-muted">{t("folderType")}</TableCell>
      <TableCell className="text-muted">{countsLabel}</TableCell>
      <TableCell>
        {!isAncestorOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("folderActions")}
                className="flex size-6 items-center justify-center rounded text-muted opacity-0 hover:bg-panel group-hover:opacity-100"
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
      </TableCell>
    </TableRow>
  );
}

function DocumentRow({
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
} & React.HTMLAttributes<HTMLTableRowElement>) {
  const t = useTranslations("folders");
  const item = { kind: "document" as const, id: document.id, document };

  return (
    <TableRow
      {...rest}
      className={cn("cursor-pointer", selected && "bg-panel-strong", focused && "ring-2 ring-inset ring-ring", isCut && "opacity-50")}
      data-selected={selected}
      draggable
      onClick={(e) => bag.onItemMouseDown(item, e)}
      onContextMenu={(e) => {
        e.stopPropagation();
        rest.onContextMenu?.(e);
      }}
      onDoubleClick={() => bag.onItemOpen(item)}
      onDragStart={(e) => bag.onItemDragStart(item, e)}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted" />
          <span className="truncate">{document.title}</span>
        </div>
      </TableCell>
      <TableCell className="text-muted">{t("documentType")}</TableCell>
      <TableCell className="text-muted">—</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DocumentActionsMenu
          detailHref={`/dashboard/documents/${document.id}`}
          documentId={document.id}
          onChanged={bag.onChanged}
          title={document.title}
        />
      </TableCell>
    </TableRow>
  );
}
