import type { Pool, PoolClient } from 'pg';
import type { PaymentMethod, PaymentProvider } from '../payments/mock-psp';
import {
  ClassFull,
  DuplicateBooking,
  Forbidden,
  NotFound,
} from '../lib/errors';

// A trial has a single fixed nominal price; the schema stores no per-class
// price, so the amount recorded on each payment_attempts row comes from here.
const TRIAL_PRICE_CENTS = 5000;
const CURRENCY = 'SGD';

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'payment_failed'
  | 'seat_lost'
  | 'expired';

export interface Booking {
  id: string;
  studentId: string;
  trialClassId: string;
  parentId: string;
  status: BookingStatus;
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapBooking(row: Record<string, unknown>): Booking {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    trialClassId: row.trial_class_id as string,
    parentId: row.parent_id as string,
    status: row.status as BookingStatus,
    holdExpiresAt: (row.hold_expires_at as Date | null) ?? null,
    confirmedAt: (row.confirmed_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

// Match on the constraint name, not the 23505 code alone: other unique
// constraints (e.g. parents.email) must not be mistaken for a duplicate booking.
function isConstraintViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505' &&
    (err as { constraint?: string }).constraint === constraint
  );
}

async function recordAttempt(
  client: PoolClient,
  bookingId: string,
  stage: 'authorise' | 'capture' | 'void',
  status: 'succeeded' | 'failed',
  providerRef: string,
  failureCode: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO payment_attempts
       (booking_id, stage, status, provider_ref, amount_cents, currency, failure_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [bookingId, stage, status, providerRef, TRIAL_PRICE_CENTS, CURRENCY, failureCode],
  );
}

export function createBookingService(deps: { pool: Pool; psp: PaymentProvider }) {
  const { pool, psp } = deps;

  async function createBooking(
    parentId: string,
    studentId: string,
    trialClassId: string,
  ): Promise<Booking> {
    const student = await pool.query<{ parent_id: string }>(
      'SELECT parent_id FROM students WHERE id = $1',
      [studentId],
    );
    if (student.rowCount === 0 || student.rows[0].parent_id !== parentId) {
      throw new Forbidden('student does not belong to parent');
    }

    const cls = await pool.query<{ capacity: number; confirmed_count: number; is_future: boolean }>(
      'SELECT capacity, confirmed_count, (starts_at > now()) AS is_future FROM trial_classes WHERE id = $1',
      [trialClassId],
    );
    if (cls.rowCount === 0) throw new NotFound('trial class not found');
    if (!cls.rows[0].is_future) throw new NotFound('trial class has already started');

    // Advisory courtesy check ONLY — this is NOT the enforcement point. It
    // spares an obviously-full class a pointless pending hold, but it reads the
    // denormalised counter without a lock and can be stale by confirm time.
    // The seat is actually enforced by the conditional UPDATE in confirmBooking
    // (step 7), backed by the trial_classes_capacity_not_exceeded CHECK.
    if (cls.rows[0].confirmed_count >= cls.rows[0].capacity) {
      throw new ClassFull('trial class is full');
    }

    try {
      const inserted = await pool.query(
        `INSERT INTO bookings (student_id, trial_class_id, parent_id, status, hold_expires_at)
         VALUES ($1, $2, $3, 'pending_payment', now() + interval '15 minutes')
         RETURNING *`,
        [studentId, trialClassId, parentId],
      );
      return mapBooking(inserted.rows[0]);
    } catch (err) {
      if (isConstraintViolation(err, 'bookings_one_active_per_student_class')) {
        throw new DuplicateBooking('an active booking already exists for this student and class');
      }
      throw err;
    }
  }

  // Correctness is four layers, each with one job. (1) The TRANSACTION is the consistency boundary. (2) The
  // FOR UPDATE lock on the booking row serialises this path against the expiry job and a double-submit of the
  // same booking. (3) The conditional UPDATE arbitrates between DIFFERENT bookings racing for one seat — the
  // central mechanism, but not the only one. (4) The CHECK constraint is the backstop that keeps the ceiling
  // unreachable if the layers above are ever wrong.
  // Seat is claimed by conditional UPDATE, not by counting rows first: count-then-insert is a TOCTOU race where
  // two callers both read 3 and both insert. Authorise runs BEFORE the claim so a declined card never touches
  // the counter and the locked section holds one external network call, not two.
  // Lock scope, honestly: once the seat is claimed at step 7 the trial_classes row lock is held until COMMIT,
  // with psp.capture inside that window. Deliberate — seat and captured payment commit together or neither.
  // Cost: concurrent confirmations for one class serialise behind a single payment round trip; immaterial at 4
  // seats, not at high volume, where the fix is to split claim and capture across two transactions with a
  // reconciliation worker covering the window.
  // A failed void is acceptable residual risk: an uncaptured authorisation expires on its own; a failed refund leaves real money in the wrong account until a human intervenes.
  async function confirmBooking(
    bookingId: string,
    paymentMethod: PaymentMethod,
  ): Promise<Booking> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock the booking row for the duration of the transaction.
      const sel = await client.query(
        `SELECT *, (now() > hold_expires_at) AS is_expired
           FROM bookings WHERE id = $1 FOR UPDATE`,
        [bookingId],
      );
      if (sel.rowCount === 0) throw new NotFound('booking not found');
      const b = sel.rows[0];

      // 2 & 3. Idempotent / non-actionable states: return unchanged.
      if (b.status === 'confirmed') {
        await client.query('COMMIT');
        return mapBooking(b);
      }
      if (b.status !== 'pending_payment') {
        await client.query('COMMIT');
        return mapBooking(b);
      }

      // 4. Entry check: stops a booking whose hold had already lapsed before
      // any payment call was made. This is the first of two points the
      // deadline is enforced — see step 7 for the second. The deadline is
      // enforced unconditionally, not only on entry.
      if (b.is_expired) {
        const u = await client.query(
          `UPDATE bookings SET status = 'expired', updated_at = now() WHERE id = $1 RETURNING *`,
          [bookingId],
        );
        await client.query('COMMIT');
        return mapBooking(u.rows[0]);
      }

      // 5. Authorise, and record the attempt regardless of outcome.
      const auth = await psp.authorise(paymentMethod);
      await recordAttempt(
        client,
        bookingId,
        'authorise',
        auth.status === 'authorised' ? 'succeeded' : 'failed',
        auth.ref,
        auth.status === 'declined' ? auth.failureCode : null,
      );

      // 6. Declined: mark payment_failed. confirmed_count is not touched.
      if (auth.status !== 'authorised') {
        const u = await client.query(
          `UPDATE bookings SET status = 'payment_failed', updated_at = now() WHERE id = $1 RETURNING *`,
          [bookingId],
        );
        await client.query('COMMIT');
        return mapBooking(u.rows[0]);
      }

      // 7. Second check: the hold can lapse while authorisation was in
      // flight. now() is fixed at transaction start, so this uses
      // clock_timestamp(), the actual wall clock time, to catch it. Void the
      // just-authorised payment and mark expired before ever attempting the
      // seat claim. Rejected alternative: entry-only enforcement, on the
      // grounds that once authorisation succeeds the hold protects only the
      // duplicate guard, which this parent is about to consume anyway.
      // Rejected because a deadline enforced only sometimes is harder to
      // reason about than one that always is.
      const stillLive = await client.query<{ is_expired: boolean }>(
        'SELECT clock_timestamp() > $1 AS is_expired',
        [b.hold_expires_at],
      );
      if (stillLive.rows[0].is_expired) {
        const voided = await psp.void(auth.ref);
        await recordAttempt(client, bookingId, 'void', 'succeeded', voided.ref);
        const u = await client.query(
          `UPDATE bookings SET status = 'expired', updated_at = now() WHERE id = $1 RETURNING *`,
          [bookingId],
        );
        await client.query('COMMIT');
        return mapBooking(u.rows[0]);
      }

      // 8. Claim the seat with the conditional UPDATE (the enforcement point).
      const claim = await client.query(
        `UPDATE trial_classes
            SET confirmed_count = confirmed_count + 1
          WHERE id = $1 AND confirmed_count < capacity
          RETURNING confirmed_count`,
        [b.trial_class_id],
      );

      // 9. Zero rows: the class filled while this user was paying. Void (no
      //    funds were ever captured) and mark seat_lost.
      if (claim.rowCount === 0) {
        const voided = await psp.void(auth.ref);
        await recordAttempt(client, bookingId, 'void', 'succeeded', voided.ref);
        const u = await client.query(
          `UPDATE bookings SET status = 'seat_lost', updated_at = now() WHERE id = $1 RETURNING *`,
          [bookingId],
        );
        await client.query('COMMIT');
        return mapBooking(u.rows[0]);
      }

      // 10. Seat claimed: capture and confirm, all under the held locks.
      const captured = await psp.capture(auth.ref);
      await recordAttempt(client, bookingId, 'capture', 'succeeded', captured.ref);
      const u = await client.query(
        `UPDATE bookings SET status = 'confirmed', confirmed_at = now(), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [bookingId],
      );
      await client.query('COMMIT');
      return mapBooking(u.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { createBooking, confirmBooking };
}

export interface PaymentAttempt {
  stage: string;
  status: string;
  providerRef: string | null;
  amountCents: number;
  currency: string;
  failureCode: string | null;
  createdAt: Date;
}

// Read model for GET /api/bookings/[id]: the booking plus its payment-attempt
// trail, oldest first. Pure read — no psp, no transaction.
export async function getBookingWithAttempts(
  pool: Pool,
  bookingId: string,
): Promise<{ booking: Booking; attempts: PaymentAttempt[] }> {
  const b = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  if (b.rowCount === 0) throw new NotFound('booking not found');
  const a = await pool.query<{
    stage: string;
    status: string;
    provider_ref: string | null;
    amount_cents: number;
    currency: string;
    failure_code: string | null;
    created_at: Date;
  }>(
    `SELECT stage, status, provider_ref, amount_cents, currency, failure_code, created_at
       FROM payment_attempts WHERE booking_id = $1 ORDER BY created_at`,
    [bookingId],
  );
  return {
    booking: mapBooking(b.rows[0]),
    attempts: a.rows.map((r) => ({
      stage: r.stage,
      status: r.status,
      providerRef: r.provider_ref,
      amountCents: r.amount_cents,
      currency: r.currency,
      failureCode: r.failure_code,
      createdAt: r.created_at,
    })),
  };
}
