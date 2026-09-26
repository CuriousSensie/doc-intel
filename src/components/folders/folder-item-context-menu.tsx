"use client";

import { Download, ExternalLink, FolderPlus, Lock, Pencil, Scissors, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";

export type FolderItemMenuActions = {
  onOpen: () => void;
  onRename?: () => void;
  onManageAccess?: () => void;
  onManageMatch?: () => void;
  onDelete: () => void;
  onCut?: () => void;
  onNewSubfolder?: () => void;
};

export type DocumentItemMenuActions = {
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onPermissions: () => void;
  onDelete: () => void;
  onCut?: () => void;
};

// Single-item right-click menu — folders and documents get their own action set (same actions as
// the per-item dropdown menus), disabled/absent for ancestor-only folders (no menu at all,
// matching the sidebar's rule for those nodes).
export function FolderItemContextMenu({
  children,
  kind,
  disabled,
  folderActions,
  documentActions
}: {
  children: ReactNode;
  kind: "folder" | "document";
  disabled?: boolean;
  folderActions?: FolderItemMenuActions;
  documentActions?: DocumentItemMenuActions;
}) {
  const t = useTranslations("folders");
  const tDoc = useTranslations("documents.detail.actions");

  if (disabled) return <>{children}</>;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {kind === "folder" && folderActions ? (
          <>
            <ContextMenuItem onSelect={folderActions.onOpen}>
              <ExternalLink className="size-4" /> {t("open")}
            </ContextMenuItem>
            {folderActions.onNewSubfolder ? (
              <ContextMenuItem onSelect={folderActions.onNewSubfolder}>
                <FolderPlus className="size-4" /> {t("newSubfolder")}
              </ContextMenuItem>
            ) : null}
            {folderActions.onRename ? (
              <ContextMenuItem onSelect={folderActions.onRename}>
                <Pencil className="size-4" /> {t("rename")}
              </ContextMenuItem>
            ) : null}
            {folderActions.onManageAccess ? (
              <ContextMenuItem onSelect={folderActions.onManageAccess}>
                <Lock className="size-4" /> {t("manageAccess")}
              </ContextMenuItem>
            ) : null}
            {folderActions.onManageMatch ? (
              <ContextMenuItem onSelect={folderActions.onManageMatch}>
                <Sparkles className="size-4" /> {t("manageMatch")}
              </ContextMenuItem>
            ) : null}
            {folderActions.onCut ? (
              <ContextMenuItem onSelect={folderActions.onCut}>
                <Scissors className="size-4" /> {t("cut")}
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem className="text-danger" onSelect={folderActions.onDelete}>
              <Trash2 className="size-4" /> {t("delete")}
            </ContextMenuItem>
          </>
        ) : null}

        {kind === "document" && documentActions ? (
          <>
            <ContextMenuItem onSelect={documentActions.onOpen}>
              <ExternalLink className="size-4" /> {tDoc("open")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={documentActions.onDownload}>
              <Download className="size-4" /> {tDoc("download")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={documentActions.onRename}>
              <Pencil className="size-4" /> {tDoc("rename")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={documentActions.onPermissions}>
              <ShieldCheck className="size-4" /> {tDoc("permissions")}
            </ContextMenuItem>
            {documentActions.onCut ? (
              <ContextMenuItem onSelect={documentActions.onCut}>
                <Scissors className="size-4" /> {t("cut")}
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem className="text-danger" onSelect={documentActions.onDelete}>
              <Trash2 className="size-4" /> {tDoc("delete")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Right-click menu for a multi-item selection — only actions valid for the whole selection.
export function FolderBulkContextMenu({
  children,
  count,
  canCut,
  onDelete,
  onCut
}: {
  children: ReactNode;
  count: number;
  canCut: boolean;
  onDelete: () => void;
  onCut: () => void;
}) {
  const t = useTranslations("folders");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {canCut ? (
          <ContextMenuItem onSelect={onCut}>
            <Scissors className="size-4" /> {t("cut")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-danger" onSelect={onDelete}>
          <Trash2 className="size-4" /> {t("deleteSelectionTitle", { count })}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Blank-area (content-pane background) right-click menu.
export function FolderBlankAreaContextMenu({
  children,
  onNewFolder,
  onPaste,
  canPaste,
  viewMode,
  onSetViewMode
}: {
  children: ReactNode;
  onNewFolder: () => void;
  onPaste: () => void;
  canPaste: boolean;
  viewMode: "tiles" | "details";
  onSetViewMode: (mode: "tiles" | "details") => void;
}) {
  const t = useTranslations("folders");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onNewFolder}>
          <FolderPlus className="size-4" /> {t("newSubfolder")}
        </ContextMenuItem>
        {canPaste ? (
          <ContextMenuItem onSelect={onPaste}>
            <Scissors className="size-4" /> {t("paste")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onSetViewMode(viewMode === "tiles" ? "details" : "tiles")}>
          {viewMode === "tiles" ? t("viewDetails") : t("viewTiles")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
