import { getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="grid w-full gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-black">{t("profile.title")}</h1>
          <p className="mt-1 text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("profile.avatarTitle")}</CardTitle>
            <CardDescription>{t("profile.avatarDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={t("profile.avatarAlt")}
                  className="size-16 rounded-full border border-border object-cover"
                  src={profile.avatar_url}
                />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full border border-border bg-panel-strong text-xs text-muted">
                  {t("profile.noAvatar")}
                </div>
              )}
              <form action={uploadAvatarAction} className="grid min-w-0 gap-3">
                <input
                  accept={avatarConfig.allowedMimeTypes.join(",")}
                  className="max-w-full text-sm"
                  name="file"
                  required
                  type="file"
                />
                <Button className="justify-self-start" size="sm" type="submit" variant="outline">
                  {t("profile.uploadAvatar")}
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("profile.detailsTitle")}</CardTitle>
            <CardDescription>{t("profile.detailsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateProfileAction} className="grid gap-4">
              <FormMessage error={params.error} message={params.message} />
              <TextField
                defaultValue={profile?.name ?? ""}
                label={t("profile.nameLabel")}
                name="name"
                required
              />
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
              <Button className="justify-self-start" type="submit">
                {t("profile.save")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
