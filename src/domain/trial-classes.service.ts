import type { Pool } from 'pg';

export interface TrialClassSummary {
  id: string;
  subject: string;
  title: string;
  startsAt: Date;
  capacity: number;
  confirmedCount: number;
  seatsRemaining: number;
}

// Catalogue read for the listing endpoint. seats_remaining is derived from the
// denormalised counter (capacity - confirmed_count); it is a display figure,
// not an enforcement value — the seat is only ever enforced at confirm time.
export async function listTrialClasses(pool: Pool): Promise<TrialClassSummary[]> {
  const res = await pool.query<{
    id: string;
    subject: string;
    title: string;
    starts_at: Date;
    capacity: number;
    confirmed_count: number;
  }>(
    `SELECT id, subject, title, starts_at, capacity, confirmed_count
       FROM trial_classes
      ORDER BY starts_at`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    title: r.title,
    startsAt: r.starts_at,
    capacity: r.capacity,
    confirmedCount: r.confirmed_count,
    seatsRemaining: r.capacity - r.confirmed_count,
  }));
}
