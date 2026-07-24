import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DomainError, type ErrorCode } from './errors';

// The single place HTTP status is decided. Every route funnels caught errors
// through errorResponse, so the mapping lives here and nowhere else.
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  DUPLICATE_BOOKING: 409,
  CLASS_FULL: 409,
  SEAT_LOST: 409,
  BOOKING_EXPIRED: 410,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
};

export interface ErrorBody {
  code: string;
  message: string;
}

export function errorResponse(err: unknown): NextResponse<ErrorBody> {
  if (err instanceof ZodError) {
    const message = err.issues
      .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
      .join('; ');
    return NextResponse.json({ code: 'VALIDATION', message }, { status: 400 });
  }
  if (err instanceof DomainError) {
    return NextResponse.json(
      { code: err.code, message: err.message },
      { status: STATUS_BY_CODE[err.code] ?? 500 },
    );
  }
  // Anything else: a real bug or an outage. Never leak the message or a stack
  // trace — return a stable, opaque 500.
  return NextResponse.json(
    { code: 'INTERNAL', message: 'Internal server error' },
    { status: 500 },
  );
}
