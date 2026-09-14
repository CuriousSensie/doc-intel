import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { createEntityTypeFormAction } from "@/modules/entity-types/entity-types.actions";
import { listEntityTypes } from "@/modules/entity-types/entity-types.service";
import { countEntitiesByType } from "@/modules/entities/entities.service";
import { buildRequestContext } from "@/lib/service-context";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function EntitiesIndexPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  requireFeature("entities");
  const [{ user }, params] = await Promise.all([requireUser("/dashboard/entities"), searchParams]);
  const ctx = await buildRequestContext();

  const [entityTypes, counts, membership] = await Promise.all([
    listEntityTypes(ctx),
    countEntitiesByType(ctx),
    getMembership(ctx.orgId, user.id)
  ]);

  const canManage = membership?.role === "owner" || membership?.role === "admin";

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">Entities</h1>
          <p className="mt-1 text-sm text-muted">
            Customers, projects, contracts, and anything else your business tracks.
          </p>
        </div>
        {canManage ? (
          <Button asChild variant="outline">
            <Link href="/dashboard/entity-types">Manage types</Link>
          </Button>
        ) : null}
      </div>

      <FormMessage error={params.error} message={params.message} />

      {entityTypes.length === 0 ? (
        <EmptyState
          description="Entity types are seeded automatically when your organization is provisioned."
          title="No entity types yet"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {entityTypes.map((type) => (
            <Link href={`/dashboard/entities/${type.key}`} key={type.id}>
              <Card className="transition-colors hover:bg-panel-strong/40">
                <CardHeader>
                  <CardTitle>{type.name_plural}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-black">{counts[type.id] ?? 0}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>New entity type</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createEntityTypeFormAction} className="grid gap-4 sm:grid-cols-3">
              <TextField
                hint="lowercase, no spaces"
                label="Key"
                name="key"
                placeholder="supplier"
                required
              />
              <TextField label="Name" name="name" placeholder="Supplier" required />
              <TextField label="Plural name" name="namePlural" placeholder="Suppliers" required />
              <Button className="sm:col-span-3" type="submit">
                Create entity type
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
