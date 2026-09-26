"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { descendantFolderIds } from "@/components/folders/folder-dnd";
import { deleteDocumentAction } from "@/modules/documents/documents.actions";
import {
  createFolderAction,
  deleteFolderAction,
  listFolderDocumentsAction,
  renameFolderAction
} from "@/modules/folders/folders.actions";
import type { DeleteFolderMode } from "@/modules/folders/folders.schemas";
import type { Folder } from "@/modules/folders/folders.service";

type DeleteChoice = DeleteFolderMode | "purge_all";

// Recursively deletes every document under folderId (this folder + all descendant folders), then
// soft-deletes the now-empty folder subtree. The folders `delete_folder` RPC only ever *unfiles*
// documents (folder_id = null) — it never touches Paperless, since it doesn't own that
// responsibility (specs/00-overview.md D1). A real "delete everything" has to go through the same
// per-document deleteDocumentAction() every other document delete uses, one document at a time, so
// each one gets its own permission check and its own Paperless delete call.
async function purgeFolderRecursively(folder: Folder, allFolders: Folder[]): Promise<void> {
  const folderIds = [folder.id, ...descendantFolderIds(allFolders, folder.id)];

  for (const folderId of folderIds) {
    // Always re-fetch page 1: each delete shrinks the underlying result set, so paging forward
    // by page number would skip documents that shift into an already-visited page.
    for (;;) {
      const result = await listFolderDocumentsAction(folderId, { page: 1, pageSize: 50 });
      if (result.items.length === 0) break;
      for (const document of result.items) {
        await deleteDocumentAction(document.id);
      }
    }
  }

  await deleteFolderAction({ folderId: folder.id, mode: "cascade_delete_subfolders" });
}

export function DeleteFolderDialog({
  folder,
  allFolders,
  hasChildren,
  open,
  onOpenChange,
  onDeleted
}: {
  folder: Folder;
  allFolders: Folder[];
  hasChildren: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("folders");
  const [mode, setMode] = useState<DeleteChoice>("require_empty");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "purge_all") {
          await purgeFolderRecursively(folder, allFolders);
        } else {
          await deleteFolderAction({ folderId: folder.id, mode });
        }
        toast.success(t("deleted", { name: folder.name }));
        onOpenChange(false);
        onDeleted();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name: folder.name })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <p className="text-muted">{t("deleteDescription")}</p>
          <label className="flex items-start gap-2">
            <input
              checked={mode === "require_empty"}
              className="mt-1"
              name="mode"
              onChange={() => setMode("require_empty")}
              type="radio"
            />
            <span>{t("deleteMode.requireEmpty")}</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              checked={mode === "reassign_documents_to_null"}
              className="mt-1"
              name="mode"
              onChange={() => setMode("reassign_documents_to_null")}
              type="radio"
            />
            <span>{t("deleteMode.reassignToNull")}</span>
          </label>
          {hasChildren ? (
            <label className="flex items-start gap-2">
              <input
                checked={mode === "cascade_delete_subfolders"}
                className="mt-1"
                name="mode"
                onChange={() => setMode("cascade_delete_subfolders")}
                type="radio"
              />
              <span>{t("deleteMode.cascade")}</span>
            </label>
          ) : null}
          <label className="flex items-start gap-2">
            <input
              checked={mode === "purge_all"}
              className="mt-1"
              name="mode"
              onChange={() => setMode("purge_all")}
              type="radio"
            />
            <span className="text-danger">{t("deleteMode.purgeAll")}</span>
          </label>
          {error ? <p className="text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending} onClick={submit} type="button" variant="default">
            {isPending && mode === "purge_all" ? t("deleting") : t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameFolderDialog({
  folder,
  open,
  onOpenChange,
  onRenamed
}: {
  folder: Folder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const t = useTranslations("folders");
  const [name, setName] = useState(folder.name);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await renameFolderAction({ folderId: folder.id, name });
        onOpenChange(false);
        onRenamed();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("renameFailed"));
      }
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("renameTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          value={name}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending || !name.trim()} onClick={submit} type="button">
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewSubfolderDialog({
  parentFolderId,
  open,
  onOpenChange,
  onCreated
}: {
  parentFolderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations("folders");
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await createFolderAction({ parentFolderId, name });
        setName("");
        onOpenChange(false);
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("createFailed"));
      }
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newFolderTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t("namePlaceholder")}
          value={name}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending || !name.trim()} onClick={submit} type="button">
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSelectionDialog({
  count,
  open,
  onOpenChange,
  onConfirm,
  isPending
}: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const t = useTranslations("folders");

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteSelectionTitle", { count })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">{t("deleteSelectionDescription")}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending} onClick={onConfirm} type="button">
            {t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
