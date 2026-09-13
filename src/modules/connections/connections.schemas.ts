import { z } from "zod";

const connectableKind = z.enum(["document", "entity"]);
const relation = z.enum(["belongs_to", "issued_to", "assigned_to", "part_of", "related"]);

// createdVia/ruleId are deliberately not user-settable here — a human creating a connection
// through this action always produces a "manual" one. Phase 4's rules engine calls
// connections.service.ts's createConnection() directly with createdVia: "rule", bypassing this
// schema entirely, since it isn't validating a browser-submitted request.
export const createConnectionSchema = z.object({
  sourceKind: connectableKind,
  sourceId: z.string().uuid(),
  targetKind: connectableKind,
  targetId: z.string().uuid(),
  relation: relation.default("related")
});

export const getConnectionsSchema = z.object({
  kind: connectableKind,
  id: z.string().uuid()
});
