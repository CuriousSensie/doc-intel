import { getTranslations } from "next-intl/server";
import { ImportUpload } from "@/components/imports/import-upload";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { getMembership } from "@/modules/organizations/organizations.service";
import { listImportMappings } from "@/modules/imports/imports.service";

export const dynamic = "force-dynamic";
export default async function NewImportPage() {
  requireFeature("imports");
  const ctx = await buildRequestContext();
  const [membership, mappings, t] = await Promise.all([
    getMembership(ctx.orgId, ctx.actorId!),
    listImportMappings(ctx),
    getTranslations("imports")
  ]);
  if (!membership || membership.role === "read-only")
    return <p className="text-muted">{t("readOnly")}</p>;
  return <ImportUpload mappings={mappings} />;
}
