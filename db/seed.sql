-- ===========================================================================
-- db/seed.sql — deterministic demo/test seed. Rerunnable: it truncates all
-- five tables first, then re-inserts a fixed set of rows with stable UUIDs.
-- Run with:  psql "$DATABASE_URL" -f db/seed.sql
--
-- Row-to-edge-case map (so a reviewer reading only this file understands the
-- whole test surface):
--
--   Families (parents + one child each):
--     P1 Budi Santoso / S1 Putri Santoso     — Indonesian
--     P2 Tan Wei Jie  / S2 Rachel Tan        — Singaporean
--     P3 Dewi Lestari / S3 Rangga Lestari    — Indonesian
--     P4 Siti Rahmah  / S4 Amir Rahman       — extra family, see note [B]
--
--   Class A (Science, this coming Friday) — the "booking states" class.
--     Carries one booking in each non-race state so every such edge is
--     reproducible against one class:
--       - confirmed booking (S1): retry the SAME child on Class A to trigger
--         DuplicateBooking via the bookings_one_active_per_student_class index.
--       - payment_failed booking (S2) + its payment_attempts row
--         (authorise / failed / card_declined): proves a failed payment leaves
--         NO trace on the roster — it is not in confirmed_count and shows on no
--         seat. This is the "failed payment doesn't hold a seat" assertion.
--       - pending_payment booking (S3) with hold_expires_at in the PAST: the
--         exact input the expire-holds job consumes. Running the job flips it
--         to 'expired', dropping it from the active predicate and freeing the
--         child to retry.
--
--   Class B (Mathematics, this coming Saturday) — the RACE / last-seat class.
--     Exactly 3 confirmed of 4 (one seat free) and deliberately clean: no
--     holds, no failed rows. Concurrency tests start from a known
--     "one seat left" state and fight for the final seat.
--
--   Class C (Science, this coming Sunday) — the FULL class. 4 confirmed of 4.
--     Used to assert ClassFull is raised before any seat arithmetic happens.
--
-- Two deliberate deviations from a literal reading of the brief, both forced
-- by the schema's own invariants (which the brief says must hold and be
-- verified):
--
--   [A] Class A's brief line says "zero confirmed, four seats free", but the
--       brief ALSO requires one *confirmed* booking on Class A. A class cannot
--       hold a confirmed booking and report zero confirmed without violating
--       invariant #1 (counter drift). So Class A's confirmed_count is 1 (three
--       seats free), not 0. Invariant-correctness wins over the descriptive
--       line, as instructed.
--
--   [B] The brief says "three parents". Class C must be full with FOUR
--       confirmed bookings, and the one-active-per-student-class index forbids
--       seating the same child twice in one class — so four distinct children
--       are required. Hence a fourth family (P4/S4) exists solely to fill
--       Class C. The three named demo families remain the narrative actors.
--
-- confirmed_count on every class equals that class's confirmed-booking count,
-- so this seed passes all three queries in db/invariants.sql on a fresh run.
-- ===========================================================================

BEGIN;

-- Truncate in dependency order (children before parents) so the file is
-- rerunnable from any state.
TRUNCATE payment_attempts, bookings, students, trial_classes, parents;

-- ---------------------------------------------------------------------------
-- Parents
-- ---------------------------------------------------------------------------
INSERT INTO parents (id, name, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Budi Santoso', 'budi.santoso@gmail.com'),
  ('22222222-2222-2222-2222-222222222222', 'Tan Wei Jie',  'weijie.tan@gmail.com'),
  ('33333333-3333-3333-3333-333333333333', 'Dewi Lestari', 'dewi.lestari@outlook.com'),
  ('44444444-4444-4444-4444-444444444444', 'Siti Rahmah',  'siti.rahmah@yahoo.com.sg');

-- ---------------------------------------------------------------------------
-- Students (one child per parent)
-- ---------------------------------------------------------------------------
INSERT INTO students (id, parent_id, name, year_level) VALUES
  ('51111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Putri Santoso',  'Primary 4'),
  ('52222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Rachel Tan',     'Primary 5'),
  ('53333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Rangga Lestari', 'Primary 3'),
  ('54444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 'Amir Rahman',    'Primary 4');

-- ---------------------------------------------------------------------------
-- Trial classes
-- starts_at is computed relative to now() so the seed never goes stale: the
-- anchor is the next Friday strictly in the future (at 10:00), and Saturday /
-- Sunday follow it. Rerunning next month yields next month's weekend.
-- ---------------------------------------------------------------------------
WITH anchor AS (
  SELECT CASE WHEN fri0 <= now() THEN fri0 + interval '7 days' ELSE fri0 END AS friday
  FROM (
    SELECT date_trunc('day', now())
           + (((5 - EXTRACT(ISODOW FROM now())::int) + 7) % 7) * interval '1 day'
           + interval '10 hours' AS fri0
  ) x
)
INSERT INTO trial_classes (id, subject, title, starts_at, capacity, confirmed_count)
SELECT c.id, c.subject, c.title, a.friday + c.day_offset, c.capacity, c.confirmed_count
FROM anchor a
CROSS JOIN (VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Science',     'Primary Science Discovery (Trial)', interval '0 days', 4, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Mathematics', 'Primary Maths Mastery (Trial)',     interval '1 day',  4, 3),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'Science',     'Primary Science Discovery (Trial)', interval '2 days', 4, 4)
) AS c(id, subject, title, day_offset, capacity, confirmed_count);

-- ---------------------------------------------------------------------------
-- Bookings
--   hold_expires_at set only on the pending hold (and in the past on purpose).
--   confirmed_at set only on confirmed bookings.
-- ---------------------------------------------------------------------------
INSERT INTO bookings (id, student_id, trial_class_id, parent_id, status, hold_expires_at, confirmed_at) VALUES
  -- Class A — one booking per non-race state
  ('aa000001-0000-0000-0000-000000000001', '51111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'confirmed',       NULL,                        now() - interval '3 hours'),
  ('aa000002-0000-0000-0000-000000000002', '52222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'payment_failed', NULL,                        NULL),
  ('aa000003-0000-0000-0000-000000000003', '53333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'pending_payment', now() - interval '15 minutes', NULL),

  -- Class B — 3 confirmed of 4 (last seat free), kept clean for race tests
  ('bb000001-0000-0000-0000-000000000001', '51111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'confirmed', NULL, now() - interval '2 days'),
  ('bb000002-0000-0000-0000-000000000002', '52222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'confirmed', NULL, now() - interval '2 days'),
  ('bb000003-0000-0000-0000-000000000003', '53333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'confirmed', NULL, now() - interval '2 days'),

  -- Class C — 4 confirmed of 4 (full)
  ('cc000001-0000-0000-0000-000000000001', '51111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'confirmed', NULL, now() - interval '1 day'),
  ('cc000002-0000-0000-0000-000000000002', '52222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'confirmed', NULL, now() - interval '1 day'),
  ('cc000003-0000-0000-0000-000000000003', '53333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'confirmed', NULL, now() - interval '1 day'),
  ('cc000004-0000-0000-0000-000000000004', '54444444-4444-4444-4444-444444444444', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444', 'confirmed', NULL, now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- Payment attempts
--   Exactly one row: the failed authorise behind the Class A payment_failed
--   booking. There is intentionally no attempt row implying a captured seat
--   for it — that is the point of the "no trace on the roster" assertion.
-- ---------------------------------------------------------------------------
INSERT INTO payment_attempts (id, booking_id, stage, status, provider_ref, amount_cents, currency, failure_code) VALUES
  ('fa000001-0000-0000-0000-000000000001', 'aa000002-0000-0000-0000-000000000002', 'authorise', 'failed', 'mock_auth_ref_0001', 5000, 'SGD', 'card_declined');

COMMIT;
