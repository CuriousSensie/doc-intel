import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { avatarConfig } from "@/config/avatar";
import { updateProfileAction } from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";
import { uploadAvatarAction } from "@/modules/profile/avatar.actions";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const [{ profile, user }, params] = await Promise.all([
    requireUser("/settings/profile"),
    searchParams
  ]);
  const t = await getTranslations("settings");

  return (
    <div className="mx-auto max-w-2xl">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">{t("profile.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{user.email}</p>

        <div className="mt-6 flex items-center gap-4 border-b border-border pb-6">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={t("profile.avatarAlt")}
              className="h-16 w-16 rounded-full border border-border object-cover"
              src={profile.avatar_url}
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-panel-strong text-xs text-muted">
              {t("profile.noAvatar")}
            </div>
          )}
          <form action={uploadAvatarAction} className="flex items-center gap-3">
            <input
              accept={avatarConfig.allowedMimeTypes.join(",")}
              className="text-sm"
              name="file"
              required
              type="file"
            />
            <Button size="sm" type="submit" variant="outline">
              {t("profile.uploadAvatar")}
            </Button>
          </form>
        </div>

        <form action={updateProfileAction} className="mt-6 grid gap-4">
          <FormMessage error={params.error} message={params.message} />
          <TextField
            defaultValue={profile?.name ?? ""}
            label={t("profile.nameLabel")}
            name="name"
            required
          />
          <TextField
            defaultValue={profile?.timezone ?? "UTC"}
            label={t("profile.timezoneLabel")}
            name="timezone"
            required
          />
          <TextField
            defaultValue={profile?.locale ?? "en"}
            label={t("profile.localeLabel")}
            name="locale"
            required
          />
          <Button type="submit">{t("profile.save")}</Button>
        </form>
      </section>
    </div>
  );
}
