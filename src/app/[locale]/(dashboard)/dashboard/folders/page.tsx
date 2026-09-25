import { getTranslations } from "next-intl/server";

import { FolderExplorer } from "@/components/folders/folder-explorer";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";

export const dynamic = "force-dynamic";

// ADR-0019 follow-up: folders are a top-level destination, not a documents view mode. The
// explorer is a distinct interaction model (a persistent tree with its own expand/breadcrumb
// state) that never used the listing filter bar rendered around it at ?view=folders, so it lives
// on its own route instead.
export default async function FoldersPage() {
  requireFeature("folders");
  const [{ user }, t] = await Promise.all([
    requireUser("/dashboard/folders"),
    getTranslations("folders")
  ]);
  const organizationId = await getActiveOrganizationId(user.id);

  if (!organizationId) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="w-full rounded-lg border border-border bg-panel p-6 text-center shadow-sm">
          <h1 className="text-3xl font-black">{t("title")}</h1>
          <p className="mt-3 leading-7 text-muted">{t("notInOrganization")}</p>
          <Button asChild className="mt-6" variant="outline">
            <Link href="/organizations/new">{t("createOrganization")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 flex-1 gap-5">
      <FolderExplorer />
    </div>
  );
}
