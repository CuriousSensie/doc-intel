import type { Document } from "@/modules/documents/documents.service";
import type { FolderNode } from "@/components/folders/folder-dnd";

export type ContentItem =
  | { kind: "folder"; id: string; folder: FolderNode }
  | { kind: "document"; id: string; document: Document };

// Shared prop surface both FolderTilesView and FolderDetailsView render from — kept in one place
// so the two views can never drift on what a "selectable, drag/drop-able, context-menu-able" item
// needs to do.
export type ContentPaneBag = {
  items: ContentItem[];
  isSelected: (id: string) => boolean;
  focusedId: string | null;
  cutIds: Set<string>;
  dragOverFolderId: string | null;
  onItemMouseDown: (item: ContentItem, event: React.MouseEvent) => void;
  onItemOpen: (item: ContentItem) => void;
  onItemDragStart: (item: ContentItem, event: React.DragEvent) => void;
  onFolderDragOver: (folderId: string, event: React.DragEvent) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (folderId: string, event: React.DragEvent) => void;
  folderMenuActions: (folder: FolderNode) => import("@/components/folders/folder-item-context-menu").FolderItemMenuActions;
  documentMenuActions: (
    document: Document
  ) => import("@/components/folders/folder-item-context-menu").DocumentItemMenuActions;
  onBulkDelete: () => void;
  onBulkCut: () => void;
  onChanged: () => void;
};
