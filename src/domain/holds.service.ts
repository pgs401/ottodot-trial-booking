import type { Pool } from 'pg';
import { pool as sharedPool } from '../lib/db';

/**
 * Expire stale holds: move pending_payment bookings whose hold_expires_at has
 * passed to 'expired'. Returns how many were expired.
 *
 * What this job releases is the DUPLICATE-BOOKING guard, not a seat. Under this
 * design a pending_payment booking never held a seat — seats are only ever
 * claimed at confirm time by the conditional UPDATE on confirmed_count, and a
 * hold touches nothing but the bookings_one_active_per_student_class predicate.
 * Expiring the hold simply drops the abandoned row out of that predicate so the
 * same child can be booked into the same class again. No confirmed_count changes
 * here, because none was ever taken.
 *
 * The UPDATE takes a row lock on each matching booking, so it serialises against
 * confirmBooking's FOR UPDATE: if a confirm is in flight for a row, this waits,
 * then re-checks the predicate and skips the row if the confirm already moved it
 * out of pending_payment.
 */
export async function expireStaleHolds(pool: Pool = sharedPool): Promise<number> {
  const res = await pool.query(
    `UPDATE bookings
        SET status = 'expired', updated_at = now()
      WHERE status = 'pending_payment'
        AND hold_expires_at <= now()`,
  );
  return res.rowCount ?? 0;
}
