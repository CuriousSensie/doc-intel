import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { billingOwnerType } from "@/config/billing";
import { isFeatureEnabled } from "@/config/features";
import {
  adjustCreditsAction,
  deleteOrganizationAdminAction,
  suspendOrganizationAction,
  toggleSubscriptionPlatformStatusAction,
  unsuspendOrganizationAction
} from "@/modules/admin/admin.actions";
import { listOrganizationsAdmin } from "@/modules/admin/organizations.service";

export const dynamic = "force-dynamic";

const showBillingControls = billingOwnerType === "organization";

export default async function AdminOrganizationsPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string; q?: string; error?: string; message?: string }>;
}) {
  const params = await searchParams;
  const { items, nextCursor } = await listOrganizationsAdmin({
    cursor: params.cursor,
    search: params.q
  });

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">Organizations</h1>
        <form action="/admin/organizations" className="mt-5 flex gap-3">
          <TextField defaultValue={params.q ?? ""} label="Search by name" name="q" />
          <Button className="self-end" type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="mt-4">
          <FormMessage error={params.error} message={params.message} />
        </div>
      </section>

      <section className="grid gap-3">
        {items.length === 0 ? (
          <p className="rounded-lg border border-border bg-panel p-6 text-muted">
            No organizations found.
          </p>
        ) : (
          items.map((organization) => (
            <div
              className="rounded-lg border border-border bg-panel p-4 shadow-sm"
              key={organization.id}
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="font-semibold">
                    {organization.name}
                    {organization.suspended_at ? (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                        Suspended
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted">{organization.slug}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form
                    action={
                      organization.suspended_at
                        ? unsuspendOrganizationAction
                        : suspendOrganizationAction
                    }
                  >
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <Button size="sm" type="submit" variant="outline">
                      {organization.suspended_at ? "Unsuspend" : "Suspend"}
                    </Button>
                  </form>
                  <form action={deleteOrganizationAdminAction}>
                    <input name="organizationId" type="hidden" value={organization.id} />
                    <Button size="sm" type="submit" variant="outline">
                      Delete
                    </Button>
                  </form>
                </div>
              </div>

              {showBillingControls ? (
                <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-4">
                  {isFeatureEnabled("credits") ? (
                    <form action={adjustCreditsAction} className="flex items-end gap-2">
                      <input name="organizationId" type="hidden" value={organization.id} />
                      <TextField
                        label="Credit adjustment"
                        name="amount"
                        placeholder="e.g. 100 or -50"
                        type="number"
                      />
                      <Button size="sm" type="submit" variant="outline">
                        Adjust credits
                      </Button>
                    </form>
                  ) : null}
                  {isFeatureEnabled("billing") ? (
                    <div className="flex gap-2">
                      <form action={toggleSubscriptionPlatformStatusAction}>
                        <input name="organizationId" type="hidden" value={organization.id} />
                        <input name="disabled" type="hidden" value="true" />
                        <Button size="sm" type="submit" variant="outline">
                          Disable subscription
                        </Button>
                      </form>
                      <form action={toggleSubscriptionPlatformStatusAction}>
                        <input name="organizationId" type="hidden" value={organization.id} />
                        <input name="disabled" type="hidden" value="false" />
                        <Button size="sm" type="submit" variant="outline">
                          Enable subscription
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link
              href={`/admin/organizations?cursor=${encodeURIComponent(nextCursor)}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}`}
            >
              Next page
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
