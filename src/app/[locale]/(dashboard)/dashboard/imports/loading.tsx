import { getTranslations } from "next-intl/server";
export default async function LoadingImports() {
  const t = await getTranslations("imports");
  return (
    <div className="mx-auto grid max-w-5xl gap-6" role="status">
      <span className="sr-only">{t("loading")}</span>
      <div className="h-9 w-48 rounded bg-panel-strong motion-safe:animate-pulse" />
      <div className="h-5 w-2/3 rounded bg-panel-strong motion-safe:animate-pulse" />
      <div className="h-64 rounded-lg bg-panel-strong motion-safe:animate-pulse" />
    </div>
  );
}
