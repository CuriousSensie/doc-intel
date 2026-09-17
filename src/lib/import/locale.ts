import { ImportRowError } from "./errors";

// specs/06-importer.md §Parsing: "1.234,56 must parse as 1234.56 when locale is sl-SI. Make
// this an explicit, user-visible mapping option, defaulted by locale, not a silent guess." —
// the mapping UI (Phase 3 M5) is what makes it user-visible; this is the parser it calls with
// whatever the user confirmed (or the sl-SI default), never a guess made here.
export type DecimalSeparator = "," | ".";

// Strips whitespace and a handful of currency/monetary noise characters real ERP exports
// carry (€, kn, a bare leading/trailing sign already handled by Number()) before parsing —
// specs/12-agent-rules.md's "numeric for money, never floats" is the caller's job (this
// returns a plain number the caller turns into a numeric column); this only turns text into a
// correctly-scaled number.
const NOISE_PATTERN = /[€$\s]/g;

export function parseLocaleNumber(raw: string, decimalSeparator: DecimalSeparator): number {
  const trimmed = raw.replace(NOISE_PATTERN, "").trim();
  if (trimmed === "") {
    throw new ImportRowError("INVALID_NUMBER", `"${raw}" is not a number`);
  }

  const thousandsSeparator = decimalSeparator === "," ? "." : ",";
  // Remove every thousands separator, then normalize the decimal separator to "." — order
  // matters: normalizing first would corrupt "1.234,56" (period already used).
  const withoutThousands = trimmed.split(thousandsSeparator).join("");
  const normalized =
    decimalSeparator === "."
      ? withoutThousands
      : withoutThousands.replace(decimalSeparator, ".");

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new ImportRowError("INVALID_NUMBER", `"${raw}" is not a valid decimal number`);
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new ImportRowError("INVALID_NUMBER", `"${raw}" is not a valid decimal number`);
  }

  return value;
}

// specs/06-importer.md §Parsing: "default dd.mm.yyyy; offer dd/mm/yyyy, yyyy-mm-dd." Every
// format is unambiguous once named (03.09.2026 is only ambiguous if you don't know which one
// applies) — the mapping UI resolves that ambiguity by showing parsed examples, this just
// enforces whichever format was named.
export const DATE_FORMATS = {
  "dd.MM.yyyy": /^(\d{2})\.(\d{2})\.(\d{4})$/,
  "dd/MM/yyyy": /^(\d{2})\/(\d{2})\/(\d{4})$/,
  "yyyy-MM-dd": /^(\d{4})-(\d{2})-(\d{2})$/
} as const;

export type DateFormat = keyof typeof DATE_FORMATS;

// Returns yyyy-mm-dd (documents.document_date's own column type) regardless of input format.
export function parseLocaleDate(raw: string, format: DateFormat): string {
  const trimmed = raw.trim();
  const match = DATE_FORMATS[format].exec(trimmed);
  if (!match) {
    throw new ImportRowError("INVALID_DATE", `"${raw}" does not match the ${format} format`);
  }

  const [, first, second, third] = match;
  const [year, month, day] = format === "yyyy-MM-dd" ? [first, second, third] : [third, second, first];

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  // Date rolls an invalid day/month over into the next one (e.g. 31.02.2026 -> 03.03.2026)
  // instead of throwing — round-trip the parsed value and compare rather than trusting it.
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new ImportRowError("INVALID_DATE", `"${raw}" is not a real calendar date`);
  }

  return `${year}-${month}-${day}`;
}
