import chardet from "chardet";
import iconv from "iconv-lite";

// specs/06-importer.md §Parsing: "detect; assume Windows-1250 as a likely fallback for
// Slovenian-language legacy exports before UTF-8 was universal. Mis-detected encoding turns č
// into mojibake across the entire dataset — detect, show a preview, and let the user
// override." This is the "detect" half; the mapping UI (Phase 3 M5) is the "show a preview,
// let the user override" half — this never silently commits to a guess the user can't see.
const FALLBACK_ENCODING = "windows-1250";

// UTF-8 is the one guess chardet gives a genuinely reliable signal for — real UTF-8 content
// scores ~100 here, and content that isn't valid UTF-8 at all doesn't appear in the results
// list. Below this threshold (or absent), don't trust it.
const UTF8_CONFIDENCE_THRESHOLD = 80;

export type EncodingDetection = { encoding: string; confidence: number };

// `sample` should be a head slice of the file (a few KB is plenty — chardet doesn't need the
// whole file, and the caller must not have buffered the whole file to get one anyway).
//
// Deliberately does not trust chardet's non-UTF-8 guesses at all: verified live that a real
// windows-1250-encoded Slovenian sample and windows-1252 score an exact tied confidence
// (chardet's n-gram model can't reliably tell Central-European Windows codepages apart from
// each other, or from ISO-8859-1/2, on realistic sample sizes) — trusting "whichever cousin
// chardet happened to rank first" would be a coin flip, not detection. specs/06-importer.md's
// own guidance is exactly this: assume windows-1250 whenever it isn't confidently UTF-8,
// rather than trying to disambiguate codepage cousins that can't reliably be told apart.
export function detectEncoding(sample: Buffer): EncodingDetection {
  const results = chardet.analyse(sample);
  const utf8 = results.find((result) => result.name === "UTF-8");

  if (utf8 && utf8.confidence >= UTF8_CONFIDENCE_THRESHOLD) {
    return { encoding: "UTF-8", confidence: utf8.confidence };
  }

  return { encoding: FALLBACK_ENCODING, confidence: utf8?.confidence ?? 0 };
}

export function decodeBuffer(buffer: Buffer, encoding: string): string {
  return iconv.decode(buffer, encoding);
}
