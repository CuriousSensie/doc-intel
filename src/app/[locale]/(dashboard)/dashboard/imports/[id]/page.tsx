import { notFound } from "next/navigation";
import { ImportWorkspace } from "@/components/imports/import-workspace";
import { buildRequestContext } from "@/lib/service-context";
import { NotFoundError } from "@/lib/errors";
import { requireFeature } from "@/modules/auth/authorization";
import { getMembership } from "@/modules/organizations/organizations.service";
import { listEntityTypes } from "@/modules/entity-types/entity-types.service";
import { listCustomFieldDefs } from "@/modules/custom-fields/custom-field-defs.service";
import { getImportJob } from "@/modules/imports/imports.service";

export const dynamic = "force-dynamic";
export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  requireFeature("imports");
  const { id } = await params;
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) notFound();
  const ctx = await buildRequestContext();
  const [job, entityTypes, customFields, membership] = await Promise.all([
    getImportJob(ctx, id).catch((error) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listEntityTypes(ctx),
    listCustomFieldDefs(ctx),
    getMembership(ctx.orgId, ctx.actorId!)
  ]);
  return (
    <ImportWorkspace
      key={job.id}
      initialJob={job}
      entityTypes={entityTypes}
      customFields={customFields}
      canWrite={!!membership && membership.role !== "read-only"}
    />
  );
}
