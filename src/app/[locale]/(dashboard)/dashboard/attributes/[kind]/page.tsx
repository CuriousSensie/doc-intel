import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

const attributeTitles = {
  tags: "tagsTitle",
  correspondents: "correspondentsTitle",
  "document-types": "documentTypesTitle",
  "custom-fields": "customFieldsTitle"
} as const;

export default async function AttributePage({ params }: { params: Promise<{ kind: string }> }) {
  requireFeature("documents");
  await requireUser("/dashboard/attributes");
  const [{ kind }, t] = await Promise.all([params, getTranslations("common.attributes")]);
  const titleKey = attributeTitles[kind as keyof typeof attributeTitles];

  if (!titleKey) notFound();

  return (
    <div className="grid min-w-0 gap-5">
      <EmptyState description={t("description")} title={t(titleKey)} />
    </div>
  );
}
