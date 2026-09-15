import { describe, expect, it } from "vitest";

import {
  documentImportMappingSchema,
  entityImportMappingSchema,
  mappingSchemaForKind,
  metadataOnlyImportMappingSchema
} from "./imports.schemas";

describe("entityImportMappingSchema", () => {
  it("accepts a minimal valid mapping", () => {
    const result = entityImportMappingSchema.safeParse({
      entityTypeKey: "customer",
      displayNameColumn: 1,
      identifierColumns: [{ kind: "vat", column: 0 }]
    });
    expect(result.success).toBe(true);
  });

  it("rejects a mapping with no identifier columns at all", () => {
    const result = entityImportMappingSchema.safeParse({
      entityTypeKey: "customer",
      displayNameColumn: 1,
      identifierColumns: []
    });
    expect(result.success).toBe(false);
  });
});

describe("entityLinkMappingSchema (via documentImportMappingSchema)", () => {
  it("requires identifierKind when matchBy is identifier", () => {
    const result = documentImportMappingSchema.safeParse({
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [{ entityTypeKey: "customer", matchBy: "identifier", column: 1 }]
    });
    expect(result.success).toBe(false);
  });

  it("does not require identifierKind when matchBy is display_name", () => {
    const result = documentImportMappingSchema.safeParse({
      documentBy: { strategy: "filename", column: 0 },
      entityLinks: [{ entityTypeKey: "customer", matchBy: "display_name", column: 1 }]
    });
    expect(result.success).toBe(true);
  });

  it("rejects the custom_field document-matching strategy (ADR-0016, deliberately unsupported)", () => {
    const result = documentImportMappingSchema.safeParse({
      documentBy: { strategy: "custom_field", column: 0 },
      entityLinks: []
    });
    expect(result.success).toBe(false);
  });
});

describe("metadataOnlyImportMappingSchema", () => {
  it("has no duplicateStrategy field", () => {
    const result = metadataOnlyImportMappingSchema.safeParse({
      documentBy: { strategy: "checksum", column: 0 },
      entityLinks: [],
      fields: [],
      duplicateStrategy: "skip"
    });
    // Extra keys are stripped by default zod object parsing, not rejected — confirm the field
    // simply isn't part of the parsed shape.
    expect(result.success && "duplicateStrategy" in result.data).toBe(false);
  });
});

describe("mappingSchemaForKind", () => {
  it("selects the matching schema for each kind", () => {
    expect(mappingSchemaForKind("entities")).toBe(entityImportMappingSchema);
    expect(mappingSchemaForKind("documents")).toBe(documentImportMappingSchema);
    expect(mappingSchemaForKind("metadata_only")).toBe(metadataOnlyImportMappingSchema);
  });
});
