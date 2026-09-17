import { apiError, apiSuccess } from "@/lib/api-response";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { getAuthContext } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 10;

// ADR-0009: fetched client-side by the searchable connection picker, not a form submission —
// entity name + identifier match, scoped to the active org. Documents aren't included yet
// (would need a Paperless round trip per keystroke); entities cover the primary "connect this
// document to a customer/project" flow specs/05 calls out.
export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) throw new AuthenticationError();

    const organizationId = await getActiveOrganizationId(context.user.id);
    if (!organizationId) throw new AuthorizationError("No active organization selected");

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return apiSuccess([]);

    const db = await createClient();

    const [byName, byIdentifier] = await Promise.all([
      db
        .from("entities")
        .select("id, display_name, entity_type_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .ilike("display_name", `%${q}%`)
        .limit(RESULT_LIMIT),
      db
        .from("entity_identifiers")
        .select("entity_id")
        .eq("organization_id", organizationId)
        .ilike("value", `%${q}%`)
        .limit(RESULT_LIMIT)
    ]);

    if (byName.error) throw byName.error;
    if (byIdentifier.error) throw byIdentifier.error;

    const matchedIds = new Set((byName.data ?? []).map((e) => e.id));
    const identifierEntityIds = (byIdentifier.data ?? [])
      .map((row) => row.entity_id)
      .filter((id) => !matchedIds.has(id));

    const extraEntities =
      identifierEntityIds.length > 0
        ? await db
            .from("entities")
            .select("id, display_name, entity_type_id")
            .eq("organization_id", organizationId)
            .is("deleted_at", null)
            .in("id", identifierEntityIds)
        : { data: [], error: null };

    if (extraEntities.error) throw extraEntities.error;

    const allEntities = [...(byName.data ?? []), ...(extraEntities.data ?? [])];
    const entityTypeIds = [...new Set(allEntities.map((e) => e.entity_type_id))];

    const { data: entityTypes, error: entityTypesError } =
      entityTypeIds.length > 0
        ? await db.from("entity_types").select("id, key, name").in("id", entityTypeIds)
        : { data: [], error: null };

    if (entityTypesError) throw entityTypesError;

    const entityTypeById = new Map((entityTypes ?? []).map((t) => [t.id, t]));

    const results = allEntities.slice(0, RESULT_LIMIT).map((entity) => {
      const type = entityTypeById.get(entity.entity_type_id);
      return {
        kind: "entity" as const,
        id: entity.id,
        label: entity.display_name,
        entityTypeKey: type?.key ?? null,
        entityTypeName: type?.name ?? null
      };
    });

    return apiSuccess(results);
  } catch (error) {
    return apiError(error);
  }
}
