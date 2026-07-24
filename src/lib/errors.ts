/**
 * Typed domain errors for the trial-booking flow.
 *
 * Every error carries a stable, machine-readable `code`. Callers (API routes,
 * tests, clients) branch on `code`, never on the human-readable `message`, so
 * messages can be reworded freely without breaking behaviour. The codes are
 * frozen strings — treat them as part of the public contract.
 */

export const ErrorCodes = {
  DUPLICATE_BOOKING: 'DUPLICATE_BOOKING',
  CLASS_FULL: 'CLASS_FULL',
  SEAT_LOST: 'SEAT_LOST',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Base class for all expected, domain-level failures. */
export class DomainError extends Error {
  /** Stable machine-readable code. Branch on this, not on `message`. */
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    // Keep the concrete subclass name (e.g. "ClassFull") on instances.
    this.name = new.target.name;
    this.code = code;
    // Preserve the prototype chain when compiled down to ES5-era targets so
    // `instanceof` keeps working.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The same person has already booked this class. */
export class DuplicateBooking extends DomainError {
  constructor(message = 'A booking already exists for this class.') {
    super(ErrorCodes.DUPLICATE_BOOKING, message);
  }
}

/** No seats remain; capacity has been reached. */
export class ClassFull extends DomainError {
  constructor(message = 'This class is full.') {
    super(ErrorCodes.CLASS_FULL, message);
  }
}

/** A held seat was taken by another booking before this one was confirmed. */
export class SeatLost extends DomainError {
  constructor(message = 'The held seat was lost to another booking.') {
    super(ErrorCodes.SEAT_LOST, message);
  }
}

/** The booking hold has passed its expiry and is no longer valid. */
export class BookingExpired extends DomainError {
  constructor(message = 'This booking has expired.') {
    super(ErrorCodes.BOOKING_EXPIRED, message);
  }
}

/** The caller is not permitted to act on this resource. */
export class Forbidden extends DomainError {
  constructor(message = 'You are not allowed to perform this action.') {
    super(ErrorCodes.FORBIDDEN, message);
  }
}

/** The requested resource does not exist. */
export class NotFound extends DomainError {
  constructor(message = 'The requested resource was not found.') {
    super(ErrorCodes.NOT_FOUND, message);
  }
}
