"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

export function SharedWithYouBadge() {
  const t = useTranslations("documents.share");
  return (
    <Badge className="mt-1 w-fit" variant="outline">
      {t("sharedWithYou")}
    </Badge>
  );
}
