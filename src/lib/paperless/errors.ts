import {
  AppError,
  NotFoundError,
  PaperlessUnavailableError,
  RateLimitError,
  ValidationError
} from "@/lib/errors";

// 403 -> 404 always: a raw 403 confirms cross-tenant existence (docs/spike-findings.md #8).
// Caller logs ERROR separately if a 404 is unexpected for a mirrored document (sync fault).
export async function mapPaperlessError(
  res: Response,
  context: { orgId: string; path: string }
): Promise<AppError> {
  const body = await res.text().catch(() => "");

  switch (true) {
    case res.status === 403:
    case res.status === 404:
      return new NotFoundError("Not found");
    case res.status === 400 || res.status === 422:
      return new ValidationError(`Paperless rejected the request: ${body.slice(0, 500)}`);
    case res.status === 429:
      return new RateLimitError("Paperless rate limit reached");
    case res.status >= 500:
      return new PaperlessUnavailableError(`Paperless returned ${res.status} for ${context.path}`);
    default:
      return new PaperlessUnavailableError(
        `Unexpected Paperless response ${res.status} for ${context.path}: ${body.slice(0, 500)}`
      );
  }
}

// Never retry a non-idempotent POST blindly (specs/01-architecture.md).
export function isRetryablePaperlessError(res: Response | null, err: unknown): boolean {
  if (res) return res.status >= 500;
  return err instanceof TypeError; // fetch network failure
}
