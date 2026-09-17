// specs/06-importer.md §Parsing: "sniff ; before , for sl-SI exports" — a Slovenian ERP export
// commonly uses `;` (since `,` is the decimal separator, `,` as a field delimiter would
// collide with every monetary column). Order matters below: `;` is checked first so a tie in
// character counts resolves to it, matching the spec's literal priority rather than an
// arbitrary one.
const DELIMITER_CANDIDATES = [";", ",", "\t"] as const;

export type Delimiter = (typeof DELIMITER_CANDIDATES)[number];

// Counts delimiter occurrences in one representative line (the header, almost always — see
// parse.ts) rather than the whole file: sniffing needs one line, not every row.
export function sniffDelimiter(sampleLine: string): Delimiter {
  let best: Delimiter = ";";
  let bestCount = -1;

  for (const candidate of DELIMITER_CANDIDATES) {
    const count = sampleLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return best;
}
