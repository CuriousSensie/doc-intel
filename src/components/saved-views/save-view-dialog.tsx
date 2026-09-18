"use client";

import { BookmarkPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
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
import { Input } from "@/components/ui/input";
import { createSavedViewAction } from "@/modules/saved-views/saved-views.actions";

type SaveViewDialogProps = {
  buttonLabel: string;
  description: string;
  scope?: "documents" | "entities";
  viewKind: "dynamic" | "static";
  filters?: Record<string, unknown>;
  columns?: string[];
  sort?: Record<string, unknown>;
  documentIds?: string[];
  disabled?: boolean;
  size?: "default" | "sm";
};

export function SaveViewDialog({
  buttonLabel,
  description,
  scope = "documents",
  viewKind,
  filters = {},
  columns = [],
  sort,
  documentIds = [],
  disabled = false,
  size = "default"
}: SaveViewDialogProps) {
  const t = useTranslations("savedViews.actions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("nameRequired"));
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const view = await createSavedViewAction({
          name: trimmed,
          scope,
          viewKind,
          filters,
          columns,
          sort,
          documentIds,
          isShared: false
        });
        setName("");
        setOpen(false);
        if (view.scope === "documents") {
          router.push(`/dashboard/documents?savedViewId=${view.id}`);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={disabled} size={size} type="button" variant="outline">
          <BookmarkPlus aria-hidden className="size-4" />
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("saveTitle")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave();
            }}
            placeholder={t("namePlaceholder")}
            value={name}
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            disabled={isPending}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {t("cancel")}
          </Button>
          <Button disabled={isPending} onClick={handleSave} type="button">
            {isPending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
