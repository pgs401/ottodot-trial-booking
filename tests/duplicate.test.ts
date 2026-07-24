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

async function newClass() {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO trial_classes (subject, title, starts_at, capacity, confirmed_count)
     VALUES ('Science', 'Test Trial', now() + interval '7 days', 4, 0) RETURNING id`,
  );
  return r.rows[0].id;
}

beforeAll(resetAndSeed);
afterAll(async () => {
  await pool.end();
});

it('the service rejects a second active booking for the same child and class', async () => {
  const { provider } = createMockPsp();
  const svc = createBookingService({ pool, psp: provider });
  const cls = await newClass();
  const { parentId, studentId } = await newFamily();
  await svc.createBooking(parentId, studentId, cls);

  await expect(svc.createBooking(parentId, studentId, cls)).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING' });
});

it('the database rejects a duplicate written directly with raw SQL, bypassing the service entirely', async () => {
  // This test exists to prove the invariant survives the application code being
  // wrong: even a raw INSERT that skips every service-layer check must be
  // refused by the database, and the error must name the exact constraint.
  const cls = await newClass();
  const { parentId, studentId } = await newFamily();
  const insert = `INSERT INTO bookings (student_id, trial_class_id, parent_id, status, hold_expires_at)
                  VALUES ($1, $2, $3, 'pending_payment', now() + interval '15 minutes')`;
  await pool.query(insert, [studentId, cls, parentId]);

  let error: { constraint?: string } | undefined;
  try {
    await pool.query(insert, [studentId, cls, parentId]);
  } catch (err) {
    error = err as { constraint?: string };
  }

  expect(error).toBeDefined();
  expect(error?.constraint).toBe('bookings_one_active_per_student_class');
});
