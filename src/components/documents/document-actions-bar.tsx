"use client";

import { ChevronLeft, ChevronRight, Download, Share2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteDocumentAction } from "@/modules/documents/documents.actions";

export function DocumentActionsBar({
  documentId,
  previousId,
  nextId,
  ctxQuery
}: {
  documentId: string;
  previousId: string | null;
  nextId: string | null;
  // The current list's filter+sort, carried through so next/prev stays within the same
  // filtered/sorted set the visitor arrived from (see documents.service.ts's
  // getAdjacentDocumentId comment).
  ctxQuery: string;
}) {
  const t = useTranslations("documents.detail.actions");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteDocumentAction(documentId);
        router.push("/dashboard/documents");
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {previousId ? (
        <Button asChild size="icon" variant="outline">
          <Link aria-label={t("previous")} href={`/dashboard/documents/${previousId}${ctxQuery}`}>
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
      ) : (
        <Button aria-label={t("previous")} disabled size="icon" variant="outline">
          <ChevronLeft className="size-4" />
        </Button>
      )}
      {nextId ? (
        <Button asChild size="icon" variant="outline">
          <Link aria-label={t("next")} href={`/dashboard/documents/${nextId}${ctxQuery}`}>
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      ) : (
        <Button aria-label={t("next")} disabled size="icon" variant="outline">
          <ChevronRight className="size-4" />
        </Button>
      )}

      <Button asChild variant="outline">
        <a href={`/api/documents/${documentId}/download`}>
          <Download className="size-4" />
          {t("download")}
        </a>
      </Button>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button disabled variant="outline">
              <Share2 className="size-4" />
              {t("share")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("comingSoon")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Trash2 className="size-4" />
            {t("delete")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirmDescription")}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => setOpen(false)} variant="outline">
              {t("cancel")}
            </Button>
            <Button disabled={isPending} onClick={handleDelete}>
              {t("deleteConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
