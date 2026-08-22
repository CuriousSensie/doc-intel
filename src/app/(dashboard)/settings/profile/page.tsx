import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled } from "@/config/features";
import { filesConfig } from "@/config/files";
import { updateProfileAction } from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";
import { uploadAvatarAction } from "@/modules/files/files.actions";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const [{ profile, user }, params] = await Promise.all([requireUser("/settings/profile"), searchParams]);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-10">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Settings</p>
        <h1 className="mt-3 text-3xl font-black">Profile</h1>
        <p className="mt-3 leading-7 text-muted">{user.email}</p>

        {isFeatureEnabled("files") ? (
          <div className="mt-6 flex items-center gap-4 border-b border-border pb-6">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="Your avatar"
                className="h-16 w-16 rounded-full border border-border object-cover"
                src={profile.avatar_url}
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-panel-strong text-xs text-muted">
                No avatar
              </div>
            )}
            <form action={uploadAvatarAction} className="flex items-center gap-3">
              <input
                accept={filesConfig.categories.avatar.allowedMimeTypes.join(",")}
                className="text-sm"
                name="file"
                required
                type="file"
              />
              <Button size="sm" type="submit" variant="outline">
                Upload avatar
              </Button>
            </form>
          </div>
        ) : null}

        <form action={updateProfileAction} className="mt-6 grid gap-4">
          <FormMessage error={params.error} message={params.message} />
          <TextField defaultValue={profile?.name ?? ""} label="Name" name="name" required />
          <TextField defaultValue={profile?.timezone ?? "UTC"} label="Timezone" name="timezone" required />
          <TextField defaultValue={profile?.locale ?? "en"} label="Locale" name="locale" required />
          <Button type="submit">Save profile</Button>
        </form>
      </section>
    </main>
  );
}
