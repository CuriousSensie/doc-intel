import Link from "next/link";

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
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <section className="w-full rounded-lg border border-border bg-panel p-6 shadow-sm">
        <Link className="text-sm font-semibold text-muted" href="/organizations">
          Back to organizations
        </Link>
        <h1 className="mt-6 text-3xl font-black">Create organization</h1>
        <p className="mt-3 leading-7 text-muted">
          You will be the owner and can invite teammates once it is created.
        </p>
        <form action={createOrganizationAction} className="mt-6 grid gap-4">
          <FormMessage error={params.error} />
          <TextField autoComplete="organization" label="Organization name" name="name" required />
          <TextField
            hint="Lowercase letters, numbers, and hyphens. Leave blank to generate one automatically."
            label="URL slug (optional)"
            name="slug"
            pattern="[a-z0-9-]*"
          />
          <Button type="submit">Create organization</Button>
        </form>
      </section>
    </div>
  );
}
