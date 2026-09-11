import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { toSafeError } from "@/lib/errors";

// specs/03-api.md's response envelope. Error codes are AppError's existing lowercase
// convention, not the spec's literal UPPER_SNAKE — see docs/GLOSSARY.md.
export function apiSuccess<T>(data: T, meta?: Record<string, unknown>, init?: { status?: number }) {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, { status: init?.status ?? 200 });
}

export function apiError(error: unknown, details?: Record<string, unknown>) {
  const safe = toSafeError(error);
  return NextResponse.json(
    {
      error: {
        code: safe.code,
        message: safe.message,
        ...(details ? { details } : {}),
        request_id: `req_${randomUUID()}`
      }
    },
    { status: safe.status }
  );
}
