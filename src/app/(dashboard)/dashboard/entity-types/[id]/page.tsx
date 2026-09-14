import { notFound } from "next/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { TextField } from "@/components/forms/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENTITY_FIELD_TYPES } from "@/modules/entities/field-schema";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { buildRequestContext } from "@/lib/service-context";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import {
  addFieldFormAction,
  removeFieldFormAction
} from "@/modules/entity-types/entity-types.actions";
import { getEntityType, getFieldSchema } from "@/modules/entity-types/entity-types.service";
import { getMembership } from "@/modules/organizations/organizations.service";

export const dynamic = "force-dynamic";

export default async function EntityTypeFieldsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  requireFeature("entities");
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const { user } = await requireUser(`/dashboard/entity-types/${id}`);
  const ctx = await buildRequestContext();

  const membership = await getMembership(ctx.orgId, user.id);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new AuthorizationError("Only an organization owner or admin can manage entity types");
  }

  let entityType: Awaited<ReturnType<typeof getEntityType>>;
  try {
    entityType = await getEntityType(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const fieldSchema = getFieldSchema(entityType);

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div>
        <h1 className="text-3xl font-black">{entityType.name_plural}</h1>
        <p className="mt-1 text-sm text-muted">key: {entityType.key}</p>
      </div>

      <FormMessage error={search.error} message={search.message} />

      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {fieldSchema.length === 0 ? (
            <p className="text-sm text-muted">No fields yet.</p>
          ) : (
            fieldSchema.map((field) => (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel px-3 py-2"
                key={field.key}
              >
                <div>
                  <p className="text-sm font-semibold">
                    {field.label}{" "}
                    {field.hidden ? <Badge variant="muted">hidden</Badge> : null}
                    {field.identifier_kind ? (
                      <Badge variant="outline">identifier: {field.identifier_kind}</Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    key: {field.key} · type: {field.type}
                    {field.required ? " · required" : ""}
                  </p>
                </div>
                {!field.hidden ? (
                  <form action={removeFieldFormAction}>
                    <input name="entityTypeId" type="hidden" value={entityType.id} />
                    <input name="fieldKey" type="hidden" value={field.key} />
                    <Button size="sm" type="submit" variant="outline">
                      Hide
                    </Button>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add field</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addFieldFormAction} className="grid gap-4 sm:grid-cols-2">
            <input name="entityTypeId" type="hidden" value={entityType.id} />
            <TextField
              hint="lowercase snake_case"
              label="Key"
              name="key"
              placeholder="tax_id"
              required
            />
            <TextField label="Label" name="label" placeholder="Tax ID" required />
            <label className="grid gap-2 text-sm font-semibold">
              <span>Type</span>
              <select
                className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
                name="type"
                required
              >
                {ENTITY_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end text-sm font-semibold">
              <input name="required" type="checkbox" />
              Required
            </label>
            <Button className="sm:col-span-2" type="submit">
              Add field
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
