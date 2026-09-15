import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { createOrganizationAction } from "@/modules/organizations/organizations.actions";

export default async function NewOrganizationPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  requireFeature("organizations");
  await requireUser("/organizations/new");
  const t = await getTranslations("organizations");
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <section className="w-full rounded-lg border border-border bg-panel p-6 shadow-sm">
        <Link className="text-sm font-semibold text-muted" href="/organizations">
          {t("new.backToOrganizations")}
        </Link>
        <h1 className="mt-6 text-3xl font-black">{t("new.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t("new.description")}</p>
        <form action={createOrganizationAction} className="mt-6 grid gap-4">
          <FormMessage error={params.error} />
          <TextField autoComplete="organization" label={t("new.nameLabel")} name="name" required />
          <TextField
            hint={t("new.slugHint")}
            label={t("new.slugLabel")}
            name="slug"
            pattern="[a-z0-9-]*"
          />
          <Button type="submit">{t("new.submit")}</Button>
        </form>
      </section>
    </div>
  );
}
