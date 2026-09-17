import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  assertLosslessTypeChange,
  validateEntityData,
  type EntityFieldDefinition
} from "@/modules/entities/field-schema";

describe("assertLosslessTypeChange", () => {
  it("allows the one documented lossless change (string -> text)", () => {
    expect(() => assertLosslessTypeChange("string", "text")).not.toThrow();
  });

  it("allows a no-op change", () => {
    expect(() => assertLosslessTypeChange("date", "date")).not.toThrow();
  });

  it("rejects any other type change", () => {
    expect(() => assertLosslessTypeChange("string", "integer")).toThrow(ValidationError);
    expect(() => assertLosslessTypeChange("text", "string")).toThrow(ValidationError);
    expect(() => assertLosslessTypeChange("integer", "decimal")).toThrow(ValidationError);
  });
});

describe("validateEntityData", () => {
  const fieldSchema: EntityFieldDefinition[] = [
    { key: "vat", label: "VAT", type: "string", required: false, identifier_kind: "vat" },
    { key: "budget", label: "Budget", type: "monetary", required: false },
    { key: "status", label: "Status", type: "select", options: ["active", "closed"] },
    { key: "notes", label: "Notes", type: "text", hidden: true }
  ];

  it("accepts valid values for each field type", () => {
    const result = validateEntityData(fieldSchema, {
      vat: "SI12345678",
      budget: 1000,
      status: "active"
    });

    expect(result).toMatchObject({ vat: "SI12345678", budget: 1000, status: "active" });
  });

  it("rejects a value not in a select field's options", () => {
    expect(() => validateEntityData(fieldSchema, { status: "bogus" })).toThrow(ValidationError);
  });

  it("rejects the wrong type for a monetary field", () => {
    expect(() => validateEntityData(fieldSchema, { budget: "not a number" })).toThrow(
      ValidationError
    );
  });

  it("ignores a hidden (soft-removed) field rather than validating it", () => {
    expect(() =>
      validateEntityData(fieldSchema, { notes: 12345, status: "active" })
    ).not.toThrow();
  });

  it("passes through unknown keys rather than stripping them", () => {
    const result = validateEntityData(fieldSchema, { status: "active", extra_field: "kept" });
    expect(result).toMatchObject({ extra_field: "kept" });
  });
});
