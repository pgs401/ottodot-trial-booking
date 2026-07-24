import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createBookingService } from '../src/domain/booking.service';
import { getRoster } from '../src/domain/roster.service';
import { expireStaleHolds } from '../src/domain/holds.service';
import { createMockPsp, type PaymentProvider } from '../src/payments/mock-psp';

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

function service() {
  const { provider } = createMockPsp();
  return { svc: createBookingService({ pool, psp: provider }), provider };
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

async function newClass(capacity = 4, confirmed = 0) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO trial_classes (subject, title, starts_at, capacity, confirmed_count)
     VALUES ('Science', 'Test Trial', now() + interval '7 days', $1, $2) RETURNING id`,
    [capacity, confirmed],
  );
  return r.rows[0].id;
}

beforeAll(resetAndSeed);
afterAll(async () => {
  await pool.end();
});

it('a confirmed booking appears on the roster and consumes exactly one seat', async () => {
  const { svc } = service();
  const cls = await newClass(4, 0);
  const { parentId, studentId } = await newFamily();
  const booking = await svc.createBooking(parentId, studentId, cls);
  await svc.confirmBooking(booking.id, 'pm_success');

  const roster = await getRoster(pool, cls);
  expect(roster.confirmed).toHaveLength(1);
  expect(roster.confirmed[0].studentId).toBe(studentId);
  expect(roster.confirmedCount).toBe(1);
  expect(roster.seatsRemaining).toBe(3);
});

it('a declined payment leaves the child off the roster and the seat count unchanged', async () => {
  const { svc } = service();
  const cls = await newClass(4, 0);
  const { parentId, studentId } = await newFamily();
  const booking = await svc.createBooking(parentId, studentId, cls);
  const result = await svc.confirmBooking(booking.id, 'pm_decline');

  expect(result.status).toBe('payment_failed');
  const roster = await getRoster(pool, cls);
  expect(roster.confirmed).toHaveLength(0);
  expect(roster.confirmedCount).toBe(0);
  expect(roster.seatsRemaining).toBe(4);
});

it('a full class is rejected before the card is ever authorised', async () => {
  const { svc, provider } = service();
  const authorise = vi.spyOn(provider, 'authorise');
  // confirmed_count is set to capacity directly; the advisory full check reads
  // the counter, and no invariant is asserted in this file.
  const cls = await newClass(4, 4);
  const { parentId, studentId } = await newFamily();

  await expect(svc.createBooking(parentId, studentId, cls)).rejects.toMatchObject({ code: 'CLASS_FULL' });
  expect(authorise).not.toHaveBeenCalled();
});

it('confirming the same booking twice consumes only one seat', async () => {
  const { svc } = service();
  const cls = await newClass(4, 0);
  const { parentId, studentId } = await newFamily();
  const booking = await svc.createBooking(parentId, studentId, cls);
  await svc.confirmBooking(booking.id, 'pm_success');
  await svc.confirmBooking(booking.id, 'pm_success');

  const count = await pool.query<{ confirmed_count: number }>(
    'SELECT confirmed_count FROM trial_classes WHERE id = $1',
    [cls],
  );
  expect(count.rows[0].confirmed_count).toBe(1);
  const captures = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payment_attempts WHERE booking_id = $1 AND stage = 'capture'`,
    [booking.id],
  );
  expect(captures.rows[0].n).toBe(1);
});

it('an abandoned booking expires, releases the duplicate guard, and never touched the seat count', async () => {
  const { svc } = service();
  const cls = await newClass(4, 0);
  const { parentId, studentId } = await newFamily();
  const booking = await svc.createBooking(parentId, studentId, cls);
  await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [booking.id]);

  await expireStaleHolds(pool);

  const status = await pool.query<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [booking.id]);
  expect(status.rows[0].status).toBe('expired');
  const count = await pool.query<{ confirmed_count: number }>(
    'SELECT confirmed_count FROM trial_classes WHERE id = $1',
    [cls],
  );
  expect(count.rows[0].confirmed_count).toBe(0);
  // The duplicate guard is released: the same child can be booked into the same
  // class again now that the abandoned hold is out of the active predicate.
  const rebooked = await svc.createBooking(parentId, studentId, cls);
  expect(rebooked.status).toBe('pending_payment');
});

it('a booking whose hold lapses during payment is never confirmed and is never charged', async () => {
  const { provider, releaseGate } = createMockPsp();

  // Explicit coordination: resolves the instant authorise is entered, so the
  // wait below only starts once pm_gated has genuinely parked, not before.
  let signalEntered!: () => void;
  const authoriseEntered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const gatedProvider: PaymentProvider = {
    authorise: (method) => {
      const p = provider.authorise(method);
      signalEntered();
      return p;
    },
    capture: (ref) => provider.capture(ref),
    void: (ref) => provider.void(ref),
  };
  const svc = createBookingService({ pool, psp: gatedProvider });

  const cls = await newClass(4, 0);
  const { parentId, studentId } = await newFamily();
  const booking = await svc.createBooking(parentId, studentId, cls);
  // In the future when confirmBooking starts, so the entry check at step 4
  // passes; it lapses in real time while authorise sits gated open. The 2
  // second margin exists so the confirmation transaction is certain to begin
  // while the hold is still live: pool acquisition, BEGIN and the locking
  // SELECT all have to land inside this window, or the entry check at step 4
  // fires instead of the second check, and the void row assertion below is
  // what would actually catch that — the booking would still end up
  // 'expired' either way, but only the second check writes a void row.
  await pool.query(`UPDATE bookings SET hold_expires_at = now() + interval '2 seconds' WHERE id = $1`, [booking.id]);

  const confirmPromise = svc.confirmBooking(booking.id, 'pm_gated');
  await authoriseEntered;
  await new Promise((r) => setTimeout(r, 2500)); // let the hold genuinely lapse in wall clock time
  releaseGate('psp_ref_1');
  const result = await confirmPromise;

  expect(result.status).toBe('expired');
  const voidRows = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payment_attempts WHERE booking_id = $1 AND stage = 'void'`,
    [booking.id],
  );
  const captureRows = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payment_attempts WHERE booking_id = $1 AND stage = 'capture'`,
    [booking.id],
  );
  expect(voidRows.rows[0].n).toBe(1);
  expect(captureRows.rows[0].n).toBe(0);
  const count = await pool.query<{ confirmed_count: number }>(
    'SELECT confirmed_count FROM trial_classes WHERE id = $1',
    [cls],
  );
  expect(count.rows[0].confirmed_count).toBe(0);
});
