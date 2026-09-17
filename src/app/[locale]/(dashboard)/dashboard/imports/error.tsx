"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
export default function ImportsError({ reset }: { reset: () => void }) {
  const t = useTranslations("imports");
  return (
    <div className="mx-auto grid max-w-3xl gap-4" role="alert">
      <h1 className="text-2xl font-semibold">{t("loadError")}</h1>
      <p className="text-muted">{t("loadErrorHelp")}</p>
      <Button className="justify-self-start" onClick={reset}>
        {t("tryAgain")}
      </Button>
    </div>
  );
}
