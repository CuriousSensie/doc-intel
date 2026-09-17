"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useTransition } from "react";

import { deleteConnectionAction } from "@/modules/connections/connections.actions";

export function DisconnectConnectionButton({ connectionId }: { connectionId: string }) {
  const t = useTranslations("connections.panel");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-label={t("disconnect")}
      className="rounded-full p-0.5 text-muted hover:bg-panel-strong hover:text-danger disabled:opacity-50"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteConnectionAction(connectionId);
          router.refresh();
        })
      }
      type="button"
    >
      <X className="size-3.5" />
    </button>
  );
}
