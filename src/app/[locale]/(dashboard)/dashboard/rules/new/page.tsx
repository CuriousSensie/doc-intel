import { getTranslations } from "next-intl/server";

import { RuleForm } from "@/components/rules/rule-form";
import { AuthorizationError } from "@/lib/errors";
import { paperlessFor } from "@/lib/paperless/client";
import {
  getCachedCorrespondents,
  getCachedDocumentTypes,
  getCachedTags
} from "@/lib/paperless/metadata-cache";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function NewRulePage() {
  requireFeature("rules");
  const [{ user }, t] = await Promise.all([
    requireUser("/dashboard/rules/new"),
    getTranslations("rules")
  ]);
  const ctx = await buildRequestContext();

  const membership = await getMembership(ctx.orgId, user.id);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AuthorizationError(t("authorization.manageOnly"));
  }

  const client = await paperlessFor(ctx.orgId);
  const [tags, correspondents, documentTypes] = await Promise.all([
    getCachedTags(client, ctx.orgId),
    getCachedCorrespondents(client, ctx.orgId),
    getCachedDocumentTypes(client, ctx.orgId)
  ]);

  return (
    <div className="mx-auto grid w-full max-w-[1800px] gap-4 px-1 lg:h-[calc(100vh-8rem)] lg:grid-rows-[auto_minmax(0,1fr)]">
      <div className="min-w-0">
        <h1 className="text-3xl font-black">{t("form.create")}</h1>
      </div>

      <RuleForm metaOptions={{ tags, correspondents, documentTypes }} />
    </div>
  );
}
