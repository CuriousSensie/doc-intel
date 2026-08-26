import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { billingOwnerType } from "@/config/billing";
import { isFeatureEnabled } from "@/config/features";
import {
  adjustCreditsAction,
  deleteUserAdminAction,
  setAppAdminAction,
  suspendUserAction,
  toggleSubscriptionPlatformStatusAction,
  unsuspendUserAction
} from "@/modules/admin/admin.actions";
import { listUsers } from "@/modules/admin/users.service";
import { requireAdmin } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

const showBillingControls = billingOwnerType === "user";

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string; q?: string; error?: string; message?: string }>;
}) {
  const [context, params] = await Promise.all([requireAdmin(), searchParams]);
  const { items, nextCursor } = await listUsers({ cursor: params.cursor, search: params.q });

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <h1 className="text-3xl font-black">Users</h1>
        <form action="/admin/users" className="mt-5 flex gap-3">
          <TextField defaultValue={params.q ?? ""} label="Search by email" name="q" />
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
          <p className="rounded-lg border border-border bg-panel p-6 text-muted">No users found.</p>
        ) : (
          items.map((user) => (
            <div className="rounded-lg border border-border bg-panel p-4 shadow-sm" key={user.id}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="font-semibold">
                    {user.name ?? user.email}
                    {user.is_app_admin ? (
                      <span className="ml-2 rounded-full bg-panel-strong px-2 py-0.5 text-xs font-semibold text-muted">
                        Admin
                      </span>
                    ) : null}
                    {user.suspended_at ? (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                        Suspended
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted">{user.email}</p>
                </div>
                {user.id !== context.user.id ? (
                  <div className="flex flex-wrap gap-2">
                    <form action={user.suspended_at ? unsuspendUserAction : suspendUserAction}>
                      <input name="userId" type="hidden" value={user.id} />
                      <Button size="sm" type="submit" variant="outline">
                        {user.suspended_at ? "Unsuspend" : "Suspend"}
                      </Button>
                    </form>
                    <form action={setAppAdminAction}>
                      <input name="userId" type="hidden" value={user.id} />
                      <input
                        name="isAdmin"
                        type="hidden"
                        value={user.is_app_admin ? "false" : "true"}
                      />
                      <Button size="sm" type="submit" variant="outline">
                        {user.is_app_admin ? "Revoke admin" : "Make admin"}
                      </Button>
                    </form>
                    <form action={deleteUserAdminAction}>
                      <input name="userId" type="hidden" value={user.id} />
                      <Button size="sm" type="submit" variant="outline">
                        Delete
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>

              {showBillingControls && user.id !== context.user.id ? (
                <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-4">
                  {isFeatureEnabled("credits") ? (
                    <form action={adjustCreditsAction} className="flex items-end gap-2">
                      <input name="userId" type="hidden" value={user.id} />
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
                        <input name="userId" type="hidden" value={user.id} />
                        <input name="disabled" type="hidden" value="true" />
                        <Button size="sm" type="submit" variant="outline">
                          Disable subscription
                        </Button>
                      </form>
                      <form action={toggleSubscriptionPlatformStatusAction}>
                        <input name="userId" type="hidden" value={user.id} />
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
              href={`/admin/users?cursor=${encodeURIComponent(nextCursor)}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}`}
            >
              Next page
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
