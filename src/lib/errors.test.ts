import { describe, expect, it } from 'vitest';
import {
  BookingExpired,
  ClassFull,
  DomainError,
  DuplicateBooking,
  ErrorCodes,
  Forbidden,
  NotFound,
  SeatLost,
} from './errors';

describe('domain errors', () => {
  it('each error carries its stable machine-readable code', () => {
    expect(new DuplicateBooking().code).toBe(ErrorCodes.DUPLICATE_BOOKING);
    expect(new ClassFull().code).toBe(ErrorCodes.CLASS_FULL);
    expect(new SeatLost().code).toBe(ErrorCodes.SEAT_LOST);
    expect(new BookingExpired().code).toBe(ErrorCodes.BOOKING_EXPIRED);
    expect(new Forbidden().code).toBe(ErrorCodes.FORBIDDEN);
    expect(new NotFound().code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('are catchable as DomainError and as Error', () => {
    const err = new ClassFull();
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(Error);
  });

  it('keep the concrete subclass name for logging', () => {
    expect(new NotFound().name).toBe('NotFound');
  });
});
