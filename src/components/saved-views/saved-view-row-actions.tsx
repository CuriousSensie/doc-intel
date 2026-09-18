"use client";

import { MoreHorizontal, Pencil, Trash2, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Link } from "@/i18n/navigation";
import {
  deleteSavedViewAction,
  renameSavedViewAction
} from "@/modules/saved-views/saved-views.actions";

export function SavedViewRowActions({
  id,
  name,
  href
}: {
  id: string;
  name: string;
  href: string;
}) {
  const t = useTranslations("savedViews.actions");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function rename() {
    const next = window.prompt(t("renamePrompt"), name);
    if (!next || next.trim() === name) return;
    startTransition(async () => {
      await renameSavedViewAction({ id, name: next.trim() });
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(t("deleteConfirm", { name }))) return;
    startTransition(async () => {
      await deleteSavedViewAction(id);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t("openMenu")} disabled={isPending} size="icon" variant="ghost">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={href}>
            <ExternalLink className="size-4" />
            {t("open")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={rename}>
          <Pencil className="size-4" />
          {t("rename")}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-danger" onClick={remove}>
          <Trash2 className="size-4" />
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
