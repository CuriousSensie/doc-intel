import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { updateProfileAction } from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";

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
