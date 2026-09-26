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
import { createFolderAction, deleteFolderAction, renameFolderAction } from "@/modules/folders/folders.actions";
import type { DeleteFolderMode } from "@/modules/folders/folders.schemas";
import type { Folder } from "@/modules/folders/folders.service";

export function DeleteFolderDialog({
  folder,
  hasChildren,
  open,
  onOpenChange,
  onDeleted
}: {
  folder: Folder;
  hasChildren: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("folders");
  const [mode, setMode] = useState<DeleteFolderMode>("require_empty");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteFolderAction({ folderId: folder.id, mode });
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
          {error ? <p className="text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending} onClick={submit} type="button" variant="default">
            {t("delete")}
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
