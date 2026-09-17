import { parseLocaleDate, parseLocaleNumber, type DateFormat } from "@/lib/import/locale";
import type { ImportJob } from "@/modules/imports/imports.service";

export const terminalStatuses = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled"
]);
export function shouldPoll(status: string) {
  return ["running", "validating", "paused"].includes(status);
}
export function importPercent(job: Pick<ImportJob, "processed_rows" | "total_rows">) {
  return job.total_rows
    ? Math.min(100, Math.max(0, Math.round((job.processed_rows / job.total_rows) * 100)))
    : 0;
}
export function parsedExample(
  raw: string,
  type: string,
  dateFormat: DateFormat,
  decimalSeparator: "," | "."
) {
  if (!raw.trim()) return "";
  if (type === "date") return parseLocaleDate(raw, dateFormat);
  if (["decimal", "monetary", "integer"].includes(type))
    return String(parseLocaleNumber(raw, decimalSeparator));
  return raw;
}
export async function unwrap<T>(promise: Promise<{ data?: T; error?: string }>): Promise<T> {
  const result = await promise;
  if (result.error || result.data === undefined) throw new Error(result.error ?? "Request failed");
  return result.data;
}
