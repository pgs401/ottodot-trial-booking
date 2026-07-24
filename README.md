# ottodot trial booking

## 1. Design philosophy

This implementation prioritises correctness over completeness. Rather than a
feature rich booking platform, the focus is the four backend invariants the
assignment names: duplicate prevention, capacity enforcement, correct payment
outcomes, and resolution of concurrent booking attempts. Other production
features, authentication, refunds, cancellation, notifications, were
deliberately excluded so the core behaviour stays easy to inspect, verify and
reason about. Everything present exists to make one of those four
invariants demonstrable, not to round out a product.

## 2. Where to look

| File | What it proves |
| --- | --- |
| `db/migrations/001_init.sql` | the invariants, and where they live |
| `src/domain/booking.service.ts` | the confirmation sequence |
| `tests/last-seat-race.test.ts` | the proof, deterministic, no sleeps |
| `tests/duplicate.test.ts` | the invariant holds when the service layer is bypassed |

## 3. Quick start

```bash
git clone https://github.com/pgs401/ottodot-trial-booking.git
cd ottodot-trial-booking
cp .env.example .env
npm install
npm run db:reset
npm run db:seed
npm test
```

Any PostgreSQL instance works by pointing `DATABASE_URL` elsewhere, so Docker
is a convenience here, not a requirement.

## 4. Verify it

| Edge case | Command |
| --- | --- |
| Duplicate prevention | `npx vitest run tests/duplicate.test.ts` |
| Capacity enforcement | `npx vitest run tests/last-seat-race.test.ts -t "never exceeds four confirmed students"` |
| Correct payment outcomes | `npx vitest run tests/booking.test.ts` |
| Resolution of concurrent booking attempts | `npx vitest run tests/last-seat-race.test.ts -t "exactly one is confirmed"` |

`npm test` output reads as a specification of what the system guarantees.
`db/invariants.sql` can also be run by hand: `psql "$DATABASE_URL" -f
db/invariants.sql`.

The same guarantees, over HTTP, after `npm run dev` and against the seeded
data (`parentId`, `studentId` and `trialClassId` below are seeded values):

```bash
# duplicate prevention: same child, same class, twice; 201 then 409
curl -X POST localhost:3000/api/bookings -H 'Content-Type: application/json' \
  -d '{"parentId":"44444444-4444-4444-4444-444444444444","studentId":"54444444-4444-4444-4444-444444444444","trialClassId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'
curl -X POST localhost:3000/api/bookings -H 'Content-Type: application/json' \
  -d '{"parentId":"44444444-4444-4444-4444-444444444444","studentId":"54444444-4444-4444-4444-444444444444","trialClassId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'

# correct payment outcomes, and the attempt trail behind them
ID=$(curl -s -X POST localhost:3000/api/bookings -H 'Content-Type: application/json' \
  -d '{"parentId":"22222222-2222-2222-2222-222222222222","studentId":"52222222-2222-2222-2222-222222222222","trialClassId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}' \
  | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
curl -X POST "localhost:3000/api/bookings/$ID/confirm" -H 'Content-Type: application/json' -d '{"paymentMethod":"pm_success"}'
curl "localhost:3000/api/bookings/$ID"

# capacity enforcement, read back over HTTP after the last seat is taken
curl localhost:3000/api/admin/classes/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/roster
```

Four of the five routes are demonstrated above; the fifth, a plain class
listing, was invoked by neither this section nor the interface and has been
removed.

## 5. Concurrency and the last seat race

Correctness in `confirmBooking` comes from four layers, each with one job.
The transaction is the consistency boundary. The `FOR UPDATE` lock on the
booking row serialises this path against the expiry job and against a
double submit of the same booking. The conditional update arbitrates
between different bookings racing for the same seat: it is the central
mechanism, but not the only one. The `CHECK` constraint is the backstop
that keeps the ceiling unreachable if every layer above it is wrong.

**Why this holds at READ COMMITTED.** The conditional update does not read
then decide; it decides inside a single statement, so READ COMMITTED's
guarantee that a writer sees the latest committed row is exactly what the
arbitration needs. A second concurrent update targeting the same row blocks
behind the first until it commits, then evaluates its own `WHERE` clause
against the row that commit left, not a stale snapshot. Nothing here
depends on repeatable reads or ordering across statements, because there is
one statement that matters and Postgres serialises writers to the same row.

**Rejected alternatives, in order.**

`SELECT FOR UPDATE` on the class row, then count. Rejected because
correctness then depends on every future caller remembering to take the
lock, and nothing in the schema enforces that. The conditional update puts
arbitration inside the statement, so the guarantee travels with the
operation.

A `seat_no` column, unique per class among confirmed rows. This would
eliminate counter drift, and was rejected for two reasons.
Allocating the next free seat number is itself a race that would need a
retry loop on unique violation. A `CHECK` constraint cannot reference
capacity on another table, so bounding `seat_no` would need either a
hardcoded ceiling that destroys per class capacity, or a trigger heavier
than the counter it replaced.

SERIALIZABLE with a retry loop. Correct, but costly for one hot row.

Count then insert: the naive baseline, a time of check to time of use race
where two callers both read three and both insert.

The tradeoff accepted is the denormalised counter. `confirmed_count` can
drift from the rows it summarises if something writes around the service
layer. It is checked, by the `CHECK` constraint and by
`db/invariants.sql`, rather than made structurally impossible.

## 6. Payment handling

Confirming a booking authorises payment, claims the seat, then captures. If
the class filled first, the authorisation is voided instead, so no funds
are captured. The provider is a test fixture with scriptable outcomes, not
the subject of this exercise.

The transaction holds a lock on the class row across the capture call. This
is deliberate: it buys atomicity, so the seat and the captured payment
commit together or neither does. Cost: concurrent confirmations for one
class serialise behind a single payment round trip, immaterial at four
seats, not at high volume, where the fix is splitting claim and capture
with a reconciliation worker, the same worker named under limitations for
unhandled capture failure. Both are the same problem.

## 7. Data model

Five tables. `parents` has a unique email, so the same guardian cannot open
a second account. `students` has a foreign key to `parents` on delete
cascade, indexed, so a deleted parent cannot leave orphaned rows.

`trial_classes` carries the `CHECK` constraint
`trial_classes_capacity_not_exceeded`, keeping `confirmed_count` between
zero and capacity. It is the backstop, not the primary mechanism.

`bookings` has three foreign keys, all on delete restrict rather than
cascade, all indexed, so a parent, student or class with live bookings
cannot be deleted out from under the seat count. Its partial unique index,
`bookings_one_active_per_student_class` on `(student_id, trial_class_id)
WHERE status IN (pending_payment, confirmed)`, is the duplicate guard. That
`pending_payment` sits inside the predicate is why an abandoned booking can
briefly lock out a retry, which is why an expiry job exists, which needs a
terminal state that means neither success nor decline, which is why the
status `expired` exists.

`payment_attempts` has a foreign key to `bookings` on delete cascade,
indexed, recording every authorise, capture and void: the audit trail a
reviewer reads on the booking status page.

## 8. Booking status

```mermaid
stateDiagram-v2
    [*] --> pending_payment
    pending_payment --> confirmed: capture succeeds
    pending_payment --> payment_failed: authorise declined
    pending_payment --> seat_lost: class filled first, voided
    pending_payment --> expired: hold passed, unresolved
    confirmed --> [*]
    payment_failed --> [*]
    seat_lost --> [*]
    expired --> [*]
```

## 9. Where each check belongs

| Check | UI | Backend | Database | Background job |
| --- | --- | --- | --- | --- |
| Child belongs to parent | filter dropdown | authorise per request | foreign key | |
| Class in the future | hide past classes | reject | | |
| Seats remaining | display only | advisory read | | |
| Duplicate booking | warn early | map error | partial unique index enforces | |
| Capacity of four | display only | interpret result | CHECK plus conditional update enforce | |
| Payment outcome | show status | record every attempt | attempt history | |
| Last seat race | never | void on loss | row lock arbitrates | |
| Stale holds | | | | expiry job |
| Counter drift | | | | invariants query in tests |

The interface exists for speed and courtesy, the backend for policy, the
database for truth, and background jobs for eventual consistency. No
invariant is enforced only in the interface or only in the backend.

## 10. Why PostgreSQL

PostgreSQL was chosen because it lets row level locking, transaction
boundaries and concurrent booking behaviour be demonstrated directly.
SQLite would also satisfy the assignment. PostgreSQL better illustrates the
concurrency guarantees because the arbitration is visible in the design
rather than supplied by the engine serialising all writes by default. On
raw SQL: for a codebase that lives for years a typed query builder is the
right default, but here the schema is the deliverable, so it is written in
the form a reviewer reads it in.

## 11. Scope

**Built.** The schema and its two named invariants, a domain service that
performs the four step confirmation sequence under lock, a mock two phase
payment fixture, an HTTP API and a thin server rendered UI, and an eleven
case integration suite run against a real database.

**Cut, one line each.** No event log table, the booking and payment_attempts
rows already are the history. No idempotency key columns, because the
partial unique index plus `SELECT FOR UPDATE` already make one unnecessary.
No capture failure and refund path. No cancellation flow. No
authentication. No separate verification endpoint, because the test suite
already proves these invariants, and two mechanisms checking the same
property can disagree with each other.

**Boundary.** The API route handlers and the interface are deliberately
outside the automated suite, because every invariant is enforced in the
domain layer and every test targets it directly. The routes parse,
delegate and map errors, and hold no correctness logic.

## 12. Limitations, monitoring and next steps

**Limitations.** The seat counter can drift and is checked rather than made
structurally impossible; a failed void leaves an authorisation to expire
naturally; capture failure after a successful seat claim is unhandled and
would need a `refund_due` status and a reconciliation worker; a crash
between capture and commit orphans a capture; there is no authentication,
so parent identity is trusted from the request; hold expiry is now
enforced at two points, on entry and immediately before the seat claim,
and the window between the second check and COMMIT remains unbounded in
principle, though nothing in it can overbook or double charge.

Every invariant that has a test was verified by deliberately removing the
guarantee and watching the test go red. Claims without a test are reasoned
rather than proven, and the hold expiry gap above was found in exactly
that space.

**Monitor.** The `seat_lost` rate, the authorise decline rate, counter
drift detections, the hold expiry backlog, and p99 latency on confirm.

**Next, by value.** A reconciliation worker for unresolved captures, the
largest financial risk; authentication, since parent identity is just
trusted; a cancellation flow, since a confirmed seat cannot be released; an
event log, once more than one team needs to ask what happened and why.

## 13. Time spent, by phase

Implementation and tests, the schema, the domain service, concurrency
correctness and the original suite: about two hours fifteen minutes.

Adversarial audit and fixes, finding the hold expiry gap and closing it:
about forty five minutes.

Documentation, the README and AI_USAGE.md: about thirty minutes.

Total: about three hours thirty minutes.
