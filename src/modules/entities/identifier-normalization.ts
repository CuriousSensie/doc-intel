// specs/02-data-model.md §Identifiers — normalization is what makes "SI 1234 5678",
// "si12345678", and "SI-12345678" collide as the same Slovenian VAT number. This is the
// import-matching foundation for Phase 3, so keep these pure and exhaustively unit-tested.

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;
const NON_DIGIT = /\D/g;
const WHITESPACE_RUN = /\s+/g;

export type IdentifierKind = "vat" | "company_reg" | "erp_id" | "email" | (string & {});

export function normalizeIdentifier(kind: IdentifierKind, value: string): string {
  const trimmed = value.trim();

  switch (kind) {
    case "vat":
      return trimmed.toUpperCase().replace(NON_ALPHANUMERIC, "");
    case "company_reg":
      return trimmed.replace(NON_DIGIT, "");
    case "erp_id":
      return trimmed.toUpperCase().replace(WHITESPACE_RUN, " ");
    case "email":
      return trimmed.toLowerCase();
    default:
      return trimmed.toUpperCase().replace(WHITESPACE_RUN, " ");
  }
}
