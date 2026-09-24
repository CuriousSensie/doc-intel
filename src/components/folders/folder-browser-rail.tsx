"use client";

import { ChevronRight, Lock, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FolderAccessManager } from "@/components/folders/folder-access-manager";
import { FolderMatchEditor } from "@/components/folders/folder-match-editor";
import { FolderTree } from "@/components/folders/folder-tree";
import { listFolderTreeAction } from "@/modules/folders/folders.actions";
import type { Folder } from "@/modules/folders/folders.service";

// Resolves a folder's ancestor id chain by walking parentFolderId on the flat list — same
// technique folder-tree.tsx uses for its client-side cycle check (ADR-0019: no separate closure
// table, path_ids isn't exposed to the client, so this is the only way to get it here).
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

// The documents list page already reads folderId/includeSubfolders off the querystring the same
// way it reads tagIds etc. (documents.schemas.ts parseDocumentsSearchParams) — this rail drives
// that same querystring rather than owning separate routes, so the substantial existing
// data-loading pipeline in dashboard/documents/page.tsx (tags, custom fields, content snippets,
// saved views…) isn't duplicated. See folders-browser final report for the full rationale.
export function FolderBrowserRail() {
  const t = useTranslations("folders");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [managingFolderId, setManagingFolderId] = useState<string | null>(null);
  const [managingTab, setManagingTab] = useState<"access" | "match" | null>(null);

  const rawFolderId = searchParams.get("folderId");
  const selectedFolderId: string | null | undefined =
    rawFolderId === null ? undefined : rawFolderId === "unfiled" ? null : rawFolderId;

  async function load() {
    try {
      setFolders(await listFolderTreeAction());
    } catch {
      setFolders([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listFolderTreeAction();
        if (!cancelled) setFolders(data);
      } catch {
        if (!cancelled) setFolders([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function navigate(folderId: string | null | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (folderId === undefined) params.delete("folderId");
    else params.set("folderId", folderId === null ? "unfiled" : folderId);
    params.delete("page");
    params.delete("cursor");
    router.push(`?${params.toString()}`);
  }

  if (folders === null) {
    return <aside className="hidden w-64 shrink-0 md:block" />;
  }

  const managingFolder = folders.find((f) => f.id === managingFolderId) ?? null;
  const breadcrumbSegments =
    typeof selectedFolderId === "string"
      ? (folders.find((f) => f.id === selectedFolderId)?.path ?? "").split("/").filter(Boolean)
      : [];
  const breadcrumbFolder = folders.find((f) => f.id === selectedFolderId) ?? null;

  return (
    <aside className="grid w-full shrink-0 gap-3 md:w-64">
      {typeof selectedFolderId === "string" && breadcrumbFolder ? (
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted md:hidden">
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
          folders={folders}
          onChanged={load}
          onNavigate={navigate}
          selectedFolderId={selectedFolderId}
        />
      </div>

      {typeof selectedFolderId === "string" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setManagingFolderId(selectedFolderId);
              setManagingTab("access");
            }}
            size="sm"
            variant="outline"
          >
            <Lock className="size-3.5" /> {t("manageAccess")}
          </Button>
          <Button
            onClick={() => {
              setManagingFolderId(selectedFolderId);
              setManagingTab("match");
            }}
            size="sm"
            variant="outline"
          >
            <Sparkles className="size-3.5" /> {t("manageMatch")}
          </Button>
        </div>
      ) : null}

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
              />
            </>
          ) : null}
          {managingFolder && managingTab === "match" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("match.title", { name: managingFolder.name })}</DialogTitle>
              </DialogHeader>
              <FolderMatchEditor folder={managingFolder} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
