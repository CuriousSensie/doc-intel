"use client";

import { Download, ExternalLink, MoreHorizontal, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type SyntheticEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { DocumentPermissionsTab } from "@/components/documents/document-permissions-tab";
import { deleteDocumentAction, updateDocumentAction } from "@/modules/documents/documents.actions";
import { getDocumentPermissionsAction } from "@/modules/documents/document-shares.actions";
import type { PermissionsResult } from "@/modules/documents/document-shares.service";

// File-level counterpart to the folder actions menus in the folder explorer: rename (title), permissions
// and delete, in one dropdown reused by both the flat listings and the explorer's document leaves.
// Open/download stay here too so a leaf has the same affordances as a listing row.
export function DocumentActionsMenu({
  documentId,
  title,
  detailHref,
  onChanged
}: {
  documentId: string;
  title: string;
  detailHref: string;
  // Called after rename/delete so the host can refresh (router.refresh() in the listings, or the
  // explorer's tree + document-cache reload).
  onChanged?: () => void;
}) {
  const t = useTranslations("documents.detail.actions");
  const tShare = useTranslations("documents.share");
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissions, setPermissions] = useState<Promise<PermissionsResult> | null>(null);
  const [name, setName] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function stop(event: SyntheticEvent) {
    event.stopPropagation();
  }

  function submitRename() {
    setError(null);
    startTransition(async () => {
      try {
        await updateDocumentAction(documentId, { title: name.trim() });
        toast.success(t("renamed"));
        setRenameOpen(false);
        onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("renameFailed"));
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteDocumentAction(documentId);
        setDeleteOpen(false);
        onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  function openPermissions() {
    setPermissions(null);
    setPermissionsOpen(true);
    setPermissions(getDocumentPermissionsAction(documentId));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t("fileActions")}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-panel-strong"
            onClick={stop}
            type="button"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stop}>
          <DropdownMenuItem asChild>
            <Link href={detailHref}>
              <ExternalLink className="size-4" /> {t("open")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/documents/${documentId}/download`}>
              <Download className="size-4" /> {t("download")}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setName(title);
              setError(null);
              setRenameOpen(true);
            }}
          >
            <Pencil className="size-4" /> {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openPermissions}>
            <ShieldCheck className="size-4" /> {t("permissions")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-danger"
            onSelect={() => {
              setError(null);
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="size-4" /> {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent onClick={stop}>
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && submitRename()}
            placeholder={t("renamePlaceholder")}
            value={name}
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => setRenameOpen(false)} type="button" variant="outline">
              {t("cancel")}
            </Button>
            <Button disabled={isPending || !name.trim()} onClick={submitRename} type="button">
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setPermissions(null);
          setPermissionsOpen(open);
        }}
        open={permissionsOpen}
      >
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" onClick={stop}>
          <DialogHeader>
            <DialogTitle>{tShare("title", { title })}</DialogTitle>
          </DialogHeader>
          {permissions ? (
            <DocumentPermissionsTab documentId={documentId} permissions={permissions} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <DialogContent onClick={stop}>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirmDescription")}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => setDeleteOpen(false)} type="button" variant="outline">
              {t("cancel")}
            </Button>
            <Button disabled={isPending} onClick={handleDelete} type="button">
              {t("deleteConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
