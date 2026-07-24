-- Invariant checks. Each query returns ZERO rows when the system is healthy;
-- any returned row is a violation and names the offending record.
--
-- These are run by the test suite as assertions after exercising the booking
-- flow, and they are equally meant to be run by hand against a live database
-- during an incident: `psql "$DATABASE_URL" -f db/invariants.sql`. They are
-- intentionally just SQL — there is no script wrapper — so they read the same
-- whether a test harness or a human on-call is running them.

-- 1. Counter drift.
-- confirmed_count on a class must equal the number of its confirmed bookings.
-- A non-zero result means the denormalised tally has diverged from the source
-- rows it summarises.
SELECT
  tc.id                 AS trial_class_id,
  tc.confirmed_count    AS recorded_count,
  COUNT(b.id)           AS actual_confirmed
FROM trial_classes tc
LEFT JOIN bookings b
  ON b.trial_class_id = tc.id
 AND b.status = 'confirmed'
GROUP BY tc.id, tc.confirmed_count
HAVING tc.confirmed_count <> COUNT(b.id);

-- 2. Overbooking.
-- No class may have more confirmed seats than its capacity. A row here means
-- the CHECK constraint was bypassed (an unexpected write path) and the class
-- is oversold.
SELECT
  id               AS trial_class_id,
  confirmed_count,
  capacity
FROM trial_classes
WHERE confirmed_count > capacity;

-- 3. Duplicate confirmed bookings.
-- A given student may hold at most one confirmed booking per class. A row here
-- means the one-active-per-student-class guard failed and the same child is
-- confirmed twice into the same class.
SELECT
  student_id,
  trial_class_id,
  COUNT(*) AS confirmed_bookings
FROM bookings
WHERE status = 'confirmed'
GROUP BY student_id, trial_class_id
HAVING COUNT(*) > 1;
