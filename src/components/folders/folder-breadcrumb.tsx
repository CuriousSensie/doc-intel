"use client";

import { ChevronRight, Home } from "lucide-react";
import { useTranslations } from "next-intl";

import { UNFILED_KEY, ancestorIds } from "@/components/folders/folder-dnd";
import type { Folder } from "@/modules/folders/folders.service";

// Breadcrumb for the currently open folder — clickable segments navigate directly (unlike the old
// tree's dashed, purely visual strip). Ancestor-only segments (accessLevel === "ancestor") stay
// plain text: the caller has never had a browsable view into them, so a click here shouldn't
// invent one.
export function FolderBreadcrumb({
  folders,
  currentFolderId,
  onNavigate
}: {
  folders: Folder[];
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
}) {
  const t = useTranslations("folders");
  const byId = new Map(folders.map((f) => [f.id, f]));

  const trail: Folder[] = (() => {
    if (!currentFolderId || currentFolderId === UNFILED_KEY) return [];
    const current = byId.get(currentFolderId);
    if (!current) return [];
    const ids = [...ancestorIds(folders, currentFolderId)].reverse();
    return [...ids.map((id) => byId.get(id)!).filter(Boolean), current];
  })();

  const currentIsUnfiled = currentFolderId === UNFILED_KEY;

  return (
    <nav
      aria-label={t("breadcrumb")}
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-panel px-3 py-2 text-xs text-muted"
    >
      <button
        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-panel-strong hover:text-foreground"
        onClick={() => onNavigate(null)}
        type="button"
      >
        <Home className="size-3.5" /> {t("allFolders")}
      </button>
      {trail.map((folder) => (
        <span className="flex items-center gap-1" key={folder.id}>
          <ChevronRight className="size-3" />
          {folder.accessLevel === "ancestor" ? (
            <span className="px-1 py-0.5 opacity-60">{folder.name}</span>
          ) : (
            <button
              className="rounded px-1 py-0.5 hover:bg-panel-strong hover:text-foreground"
              onClick={() => onNavigate(folder.id)}
              type="button"
            >
              {folder.name}
            </button>
          )}
        </span>
      ))}
      {currentIsUnfiled ? (
        <span className="flex items-center gap-1">
          <ChevronRight className="size-3" />
          <span className="px-1 py-0.5 font-medium text-foreground">{t("unfiled")}</span>
        </span>
      ) : null}
    </nav>
  );
}
