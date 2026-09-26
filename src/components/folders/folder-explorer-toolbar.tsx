"use client";

import { FolderPlus, LayoutGrid, Rows3 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FolderBreadcrumb } from "@/components/folders/folder-breadcrumb";
import type { Folder } from "@/modules/folders/folders.service";

export function FolderExplorerToolbar({
  folders,
  currentFolderId,
  viewMode,
  onNavigate,
  onSetViewMode,
  onNewFolder
}: {
  folders: Folder[];
  currentFolderId: string | null;
  viewMode: "tiles" | "details";
  onNavigate: (id: string | null) => void;
  onSetViewMode: (mode: "tiles" | "details") => void;
  onNewFolder: () => void;
}) {
  const t = useTranslations("folders");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <FolderBreadcrumb currentFolderId={currentFolderId} folders={folders} onNavigate={onNavigate} />

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-md border border-border">
          <button
            aria-label={t("viewTiles")}
            aria-pressed={viewMode === "tiles"}
            className="flex size-9 items-center justify-center border-r border-border text-muted hover:bg-panel-strong data-[active=true]:bg-panel-strong data-[active=true]:text-foreground"
            data-active={viewMode === "tiles"}
            onClick={() => onSetViewMode("tiles")}
            type="button"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            aria-label={t("viewDetails")}
            aria-pressed={viewMode === "details"}
            className="flex size-9 items-center justify-center text-muted hover:bg-panel-strong data-[active=true]:bg-panel-strong data-[active=true]:text-foreground"
            data-active={viewMode === "details"}
            onClick={() => onSetViewMode("details")}
            type="button"
          >
            <Rows3 className="size-4" />
          </button>
        </div>

        <Button onClick={onNewFolder} size="sm" variant="outline">
          <FolderPlus className="size-4" /> {t("newFolderTitle")}
        </Button>
      </div>
    </div>
  );
}
