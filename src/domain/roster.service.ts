import type { Pool } from 'pg';
import { NotFound } from '../lib/errors';

export interface RosterSeat {
  studentId: string;
  studentName: string;
  parentName: string;
  parentEmail: string;
  confirmedAt: Date | null;
}

export interface Roster {
  trialClassId: string;
  title: string;
  subject: string;
  capacity: number;
  confirmedCount: number;
  seatsRemaining: number;
  confirmed: RosterSeat[];
  // Bookings mid-payment. Explicitly NOT on the roster: a pending_payment hold
  // occupies no seat under this design, so it is reported separately as a count
  // and never mixed into `confirmed`.
  pendingPaymentNotOnRoster: number;
}

export async function getRoster(pool: Pool, trialClassId: string): Promise<Roster> {
  const cls = await pool.query<{
    title: string;
    subject: string;
    capacity: number;
    confirmed_count: number;
  }>(
    'SELECT title, subject, capacity, confirmed_count FROM trial_classes WHERE id = $1',
    [trialClassId],
  );
  if (cls.rowCount === 0) throw new NotFound('trial class not found');
  const c = cls.rows[0];

  const seats = await pool.query<{
    student_id: string;
    student_name: string;
    parent_name: string;
    parent_email: string;
    confirmed_at: Date | null;
  }>(
    `SELECT s.id   AS student_id,
            s.name AS student_name,
            p.name AS parent_name,
            p.email AS parent_email,
            b.confirmed_at
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN parents  p ON p.id = b.parent_id
      WHERE b.trial_class_id = $1 AND b.status = 'confirmed'
      ORDER BY b.confirmed_at`,
    [trialClassId],
  );

  const pending = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM bookings
      WHERE trial_class_id = $1 AND status = 'pending_payment'`,
    [trialClassId],
  );

  return {
    trialClassId,
    title: c.title,
    subject: c.subject,
    capacity: c.capacity,
    confirmedCount: c.confirmed_count,
    seatsRemaining: c.capacity - c.confirmed_count,
    confirmed: seats.rows.map((r) => ({
      studentId: r.student_id,
      studentName: r.student_name,
      parentName: r.parent_name,
      parentEmail: r.parent_email,
      confirmedAt: r.confirmed_at,
    })),
    pendingPaymentNotOnRoster: Number(pending.rows[0].count),
  };
}
