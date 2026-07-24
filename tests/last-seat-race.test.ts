import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createBookingService } from '../src/domain/booking.service';
import { createMockPsp, type PaymentProvider } from '../src/payments/mock-psp';

const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  max: 15,
});

// Seeded class B: three of four seats already confirmed (one seat free).
const CLASS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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

it('when two parents race for the last seat, exactly one is confirmed and the other is never charged', async () => {
  const { provider, releaseGate } = createMockPsp();

  // Explicit coordination, not timing: this promise resolves the moment an
  // authorise call is entered. For pm_gated the deferred gate is registered
  // synchronously before authorise's promise is awaited, so once this resolves
  // the gate exists and can be released. No sleep, no ordering-by-luck.
  let signalEntered!: () => void;
  const authoriseEntered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const provider2: PaymentProvider = {
    authorise: (method) => {
      const p = provider.authorise(method);
      signalEntered();
      return p;
    },
    capture: (ref) => provider.capture(ref),
    void: (ref) => provider.void(ref),
  };
  const svc = createBookingService({ pool, psp: provider2 });

  const a = await newFamily();
  const b = await newFamily();
  const aBooking = await svc.createBooking(a.parentId, a.studentId, CLASS_B);
  const bBooking = await svc.createBooking(b.parentId, b.studentId, CLASS_B);

  // User A confirms and blocks inside authorise (pm_gated).
  const aPromise = svc.confirmBooking(aBooking.id, 'pm_gated');
  await authoriseEntered; // A is now parked at the gate; its ref is the first issued.

  // User B confirms with pm_success and wins the last seat.
  const bResult = await svc.confirmBooking(bBooking.id, 'pm_success');
  expect(bResult.status).toBe('confirmed');

  // Release A. It resumes, finds the class full, voids, and loses the seat.
  // Refs are deterministic (psp_ref_N); A's authorise is the first call, so its
  // ref is psp_ref_1. We only release after B has committed, above.
  releaseGate('psp_ref_1');
  const aResult = await aPromise;

  expect(aResult.status).toBe('seat_lost');

  const confirmedOnB = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bookings WHERE trial_class_id = $1 AND status = 'confirmed'`,
    [CLASS_B],
  );
  expect(confirmedOnB.rows[0].n).toBe(4); // the seeded three plus exactly one winner

  const count = await pool.query<{ confirmed_count: number }>(
    'SELECT confirmed_count FROM trial_classes WHERE id = $1',
    [CLASS_B],
  );
  expect(count.rows[0].confirmed_count).toBe(4);

  const aVoid = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payment_attempts WHERE booking_id = $1 AND stage = 'void'`,
    [aBooking.id],
  );
  const aCapture = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payment_attempts WHERE booking_id = $1 AND stage = 'capture'`,
    [aBooking.id],
  );
  expect(aVoid.rows[0].n).toBe(1);
  expect(aCapture.rows[0].n).toBe(0);
});

it('a class of four seats never exceeds four confirmed students under ten simultaneous confirmations', async () => {
  const { provider } = createMockPsp();
  const svc = createBookingService({ pool, psp: provider });
  const cls = await newEmptyClass();

  const bookingIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const f = await newFamily();
    const booking = await svc.createBooking(f.parentId, f.studentId, cls);
    bookingIds.push(booking.id);
  }

  // Ten confirmations at once; confirmBooking takes its own pool connection per
  // call, so these are ten genuinely concurrent transactions.
  const results = await Promise.all(
    bookingIds.map((id) =>
      svc.confirmBooking(id, 'pm_success').then(
        (booking) => ({ ok: true as const, status: booking.status }),
        (error) => ({ ok: false as const, error }),
      ),
    ),
  );

  const confirmed = results.filter((r) => r.ok && r.status === 'confirmed').length;
  const seatLost = results.filter((r) => r.ok && r.status === 'seat_lost').length;
  const threw = results.filter((r) => !r.ok);

  expect(confirmed).toBe(4);
  expect(seatLost).toBe(6);

  const count = await pool.query<{ confirmed_count: number }>(
    'SELECT confirmed_count FROM trial_classes WHERE id = $1',
    [cls],
  );
  expect(count.rows[0].confirmed_count).toBe(4);

  // The final assertion distinguishes which layer did the work. Every losing
  // confirmation returned seat_lost cleanly; none threw. A CHECK constraint
  // violation here would mean the conditional UPDATE failed to arbitrate the
  // seat and the database backstop had to catch the overflow instead of the
  // claim — i.e. the design was leaning on the backstop, not the claim.
  expect(threw).toHaveLength(0);
});
