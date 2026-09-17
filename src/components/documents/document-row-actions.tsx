"use client";

import { Download, ExternalLink, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState, useTransition, type SyntheticEvent } from "react";

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
import { Link } from "@/i18n/navigation";
import { deleteDocumentAction } from "@/modules/documents/documents.actions";

export function DocumentRowActions({
  documentId,
  detailHref
}: {
  documentId: string;
  detailHref: string;
}) {
  const t = useTranslations("documents.detail.actions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function stop(event: SyntheticEvent) {
    event.stopPropagation();
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteDocumentAction(documentId);
        setOpen(false);
        setError(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  return (
    <TooltipProvider>
      <div
        className="flex flex-wrap items-center justify-end gap-1"
        onClick={stop}
        onDoubleClick={stop}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild aria-label={t("open")} size="icon" variant="ghost">
              <Link href={detailHref}>
                <ExternalLink className="size-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("open")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild aria-label={t("download")} size="icon" variant="ghost">
              <a href={`/api/documents/${documentId}/download`}>
                <Download className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("download")}</TooltipContent>
        </Tooltip>

        <Dialog onOpenChange={setOpen} open={open}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button aria-label={t("delete")} size="icon" variant="ghost">
                  <Trash2 className="size-4" />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("delete")}</TooltipContent>
          </Tooltip>
          <DialogContent onClick={stop} onDoubleClick={stop}>
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
    </TooltipProvider>
  );
}
