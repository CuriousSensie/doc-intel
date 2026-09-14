import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthorizationError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { listEntityTypes } from "@/modules/entity-types/entity-types.service";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function EntityTypesAdminPage() {
  requireFeature("entities");
  const { user } = await requireUser("/dashboard/entity-types");
  const ctx = await buildRequestContext();

  const membership = await getMembership(ctx.orgId, user.id);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AuthorizationError("Only an organization owner or admin can manage entity types");
  }

  const entityTypes = await listEntityTypes(ctx);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div>
        <h1 className="text-3xl font-black">Entity types</h1>
        <p className="mt-1 text-sm text-muted">
          Field schema for every entity type your organization uses.
        </p>
      </div>

      <div className="grid gap-3">
        {entityTypes.map((type) => (
          <Link href={`/dashboard/entity-types/${type.id}`} key={type.id}>
            <Card className="transition-colors hover:bg-panel-strong/40">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>{type.name_plural}</CardTitle>
                {type.is_system ? <Badge variant="muted">system</Badge> : null}
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted">key: {type.key}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
