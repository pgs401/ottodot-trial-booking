import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createBookingService } from '../src/domain/booking.service';
import { createMockPsp } from '../src/payments/mock-psp';

const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  max: 15,
});

const MIGRATION = readFileSync(join(process.cwd(), 'db/migrations/001_init.sql'), 'utf8');
const SEED = readFileSync(join(process.cwd(), 'db/seed.sql'), 'utf8');
const INVARIANTS = readFileSync(join(process.cwd(), 'db/invariants.sql'), 'utf8');

async function resetAndSeed() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(MIGRATION);
  await pool.query(SEED);
}

async function newFamily() {
  const p = await pool.query<{ id: string }>(
    `INSERT INTO parents (name, email) VALUES ('Test Parent', gen_random_uuid()::text || '@example.com') RETURNING id`,
  );
  const s = await pool.query<{ id: string }>(
    `INSERT INTO students (parent_id, name, year_level) VALUES ($1, 'Test Child', 'Primary 4') RETURNING id`,
    [p.rows[0].id],
  );
  return { parentId: p.rows[0].id, studentId: s.rows[0].id };
}

async function newEmptyClass() {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO trial_classes (subject, title, starts_at, capacity, confirmed_count)
     VALUES ('Science', 'Race Trial', now() + interval '7 days', 4, 0) RETURNING id`,
  );
  return r.rows[0].id;
}

beforeAll(resetAndSeed);
afterAll(async () => {
  await pool.end();
});

it('the seat counter never drifts from the confirmed bookings it represents', async () => {
  const { provider } = createMockPsp();
  const svc = createBookingService({ pool, psp: provider });

  // Drive a real concurrency scenario against a fresh class before checking:
  // ten simultaneous confirmations fighting for four seats.
  const cls = await newEmptyClass();
  const bookingIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const f = await newFamily();
    const booking = await svc.createBooking(f.parentId, f.studentId, cls);
    bookingIds.push(booking.id);
  }
  await Promise.all(bookingIds.map((id) => svc.confirmBooking(id, 'pm_success').catch(() => undefined)));

  // Execute db/invariants.sql: strip comments, split into its three queries,
  // and assert each returns zero rows.
  const queries = INVARIANTS.replace(/--.*$/gm, '')
    .split(';')
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
  expect(queries).toHaveLength(3);

  for (const query of queries) {
    const result = await pool.query(query);
    expect(result.rowCount).toBe(0);
  }
});
