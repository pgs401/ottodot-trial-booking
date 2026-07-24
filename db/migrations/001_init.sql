-- 001_init: initial schema for the trial-booking service (PostgreSQL 16).
--
-- Five tables: parents, students, trial_classes, bookings, payment_attempts.
-- The seat-capacity and one-active-booking invariants are enforced here, in
-- the database, because they must hold no matter which code path writes — the
-- booking API today, and the admin tools, imports, and manual fixes that do
-- not exist yet. An invariant that lives only in application code is an
-- invariant that holds only until the second writer.

-- gen_random_uuid() lives in pgcrypto. We generate ids in the database so a
-- row has an identity the instant it is inserted, independent of any
-- application's id strategy.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
-- The lifecycle of a booking, as data. Modelling it as an enum (rather than a
-- free-text status) makes illegal states unrepresentable at the column level
-- and lets the partial unique index below reference specific states by name.
CREATE TYPE booking_status AS ENUM (
  'pending_payment',
  'confirmed',
  'payment_failed',
  'seat_lost',
  'expired'
);

-- The two-phase mock payment protocol: authorise a hold, capture it, or void
-- it. Kept as an enum so a payment_attempts row can only describe a stage the
-- protocol actually has.
CREATE TYPE payment_stage AS ENUM (
  'authorise',
  'capture',
  'void'
);

-- The outcome of a single payment stage. Deliberately binary: an attempt has
-- resolved one way or the other by the time it is recorded.
CREATE TYPE payment_status AS ENUM (
  'succeeded',
  'failed'
);

-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------
CREATE TABLE parents (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  -- A parent is identified by email. Uniqueness is enforced in the database,
  -- not by an application "check then insert", because that check-then-insert
  -- is a race: two concurrent sign-ups both see no existing row and both
  -- insert. Only a unique constraint, evaluated atomically at write time,
  -- actually prevents the duplicate.
  email      text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
CREATE TABLE students (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A student cannot exist without the parent who owns the account. ON DELETE
  -- CASCADE encodes that ownership: removing a family removes its students in
  -- the same transaction. This cascade is still gated by the RESTRICTs on
  -- bookings below — a family with live bookings cannot be silently erased,
  -- because the cascade would hit those RESTRICTs and abort.
  parent_id  uuid        NOT NULL REFERENCES parents (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  year_level text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every foreign key is indexed. Without this index a delete or update on
-- parents would sequentially scan students to check the constraint, and
-- lookups of "this parent's students" would too.
CREATE INDEX students_parent_id_idx ON students (parent_id);

-- ---------------------------------------------------------------------------
-- trial_classes
-- ---------------------------------------------------------------------------
CREATE TABLE trial_classes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text        NOT NULL,
  title           text        NOT NULL,
  starts_at       timestamptz NOT NULL,
  capacity        integer     NOT NULL DEFAULT 4,
  -- confirmed_count is a denormalised tally of confirmed bookings. It exists
  -- so the last-seat claim is a single conditional UPDATE against one row,
  -- rather than a COUNT over bookings under a lock. db/invariants.sql exists
  -- to prove this tally never drifts from the underlying rows.
  confirmed_count integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Invariant: a class never holds fewer than zero or more than `capacity`
  -- confirmed seats.
  --
  -- On the normal path this constraint is expected to NEVER fire: the seat is
  -- claimed with a conditional UPDATE (... SET confirmed_count = confirmed_count + 1
  -- WHERE confirmed_count < capacity), which arbitrates the last seat before
  -- any write happens, so an over-count is never even attempted. The reason it
  -- exists anyway is to guard the paths that do not exist yet and will not go
  -- through that UPDATE: an admin tool nudging a count, a bulk import seeding
  -- classes, a manual correction typed into psql at 2am during an incident.
  -- Those are exactly the moments the tally is most likely to be pushed out of
  -- range, and exactly the moments no application code is in the loop to stop
  -- it. The database is.
  CONSTRAINT trial_classes_capacity_not_exceeded
    CHECK (confirmed_count >= 0 AND confirmed_count <= capacity)
);

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
CREATE TABLE bookings (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A booking is meaningless without the student it seats. ON DELETE RESTRICT
  -- (not CASCADE) is deliberate: deleting a student who holds a confirmed
  -- booking would silently drop a seat the counter still counts, drifting
  -- confirmed_count. RESTRICT forces the operator to resolve the booking
  -- first, keeping the tally honest.
  student_id      uuid           NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  -- Likewise a class with bookings cannot be deleted out from under them.
  -- RESTRICT protects both the booking history and the confirmed_count tally
  -- on the class row.
  trial_class_id  uuid           NOT NULL REFERENCES trial_classes (id) ON DELETE RESTRICT,
  -- parent_id is denormalised onto the booking so the owning account is known
  -- for authorisation without joining through students. RESTRICT keeps a
  -- parent with live bookings from being deleted, consistent with the student
  -- and class rules above.
  parent_id       uuid           NOT NULL REFERENCES parents (id) ON DELETE RESTRICT,
  status          booking_status NOT NULL,
  hold_expires_at timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  confirmed_at    timestamptz
);

-- Foreign-key indexes. Each supports both the FK integrity check on the parent
-- side and the common "bookings for this student / class / parent" read.
CREATE INDEX bookings_student_id_idx     ON bookings (student_id);
CREATE INDEX bookings_trial_class_id_idx ON bookings (trial_class_id);
CREATE INDEX bookings_parent_id_idx      ON bookings (parent_id);

-- Invariant: a student has at most one *active* booking per class, where
-- active means pending_payment or confirmed.
--
-- pending_payment is inside the predicate on purpose. If the window were
-- confirmed-only, a parent with two browser tabs could start two holds for the
-- same child in the same class and confirm both — a double booking that the
-- confirmed-only guard would notice only after the fact. Including
-- pending_payment makes the *second hold* itself impossible: the unique index
-- rejects it at insert time, atomically, no matter which tab or request races
-- in first.
--
-- The accepted cost is narrow and known: an abandoned pending_payment booking
-- keeps blocking a legitimate retry for the same child+class until it clears.
-- That is precisely why the hold-expiry job exists — it transitions stale
-- holds out of pending_payment (to expired), which drops them from this
-- predicate and frees the slot for a genuine retry. The index defines the
-- invariant; the job bounds how long the invariant can inconvenience an honest
-- user.
CREATE UNIQUE INDEX bookings_one_active_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status IN ('pending_payment', 'confirmed');

-- ---------------------------------------------------------------------------
-- payment_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE payment_attempts (
  id           uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A payment attempt is wholly owned by its booking and has no meaning
  -- without it. ON DELETE CASCADE removes the attempt trail when its booking
  -- is deleted; bookings themselves are shielded from disappearing underneath
  -- live data by the RESTRICTs above, so this cascade only ever fires for a
  -- booking that is genuinely being torn down.
  booking_id   uuid           NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  stage        payment_stage  NOT NULL,
  status       payment_status NOT NULL,
  provider_ref text,
  amount_cents integer        NOT NULL,
  currency     text           NOT NULL DEFAULT 'SGD',
  failure_code text,
  created_at   timestamptz    NOT NULL DEFAULT now()
);

-- Foreign-key index: supports the cascade check on delete and the "attempts
-- for this booking" read that reconstructs a booking's payment history.
CREATE INDEX payment_attempts_booking_id_idx ON payment_attempts (booking_id);
