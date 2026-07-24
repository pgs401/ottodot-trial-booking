# ottodot-trial-booking

Trial class booking service with database enforced seat capacity, two phase
mock payments, and a race safe last seat claim. Next.js 14, PostgreSQL, Vitest.

## Status

A working trial-class booking service: database-enforced seat capacity, a
two-phase mock payment fixture, a race-safe last-seat claim, an HTTP API, and
a thin server-rendered UI, all covered by an integration test suite run
against a real Postgres.

## Prerequisites

- Node.js 18+ and npm
- Docker (for the local PostgreSQL 16 container)

## Getting started

```bash
cp .env.example .env  # adjust if needed
npm install
npm run db:reset      # start Postgres on 5433, migrate, create the test db
npm run db:seed       # load demo parents, students, and classes
npm test              # run the suite against TEST_DATABASE_URL
npm run dev           # Next.js on http://localhost:3000
```

## Scripts

| Script                     | What it does                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `npm run dev`              | Start the Next.js dev server.                                   |
| `npm test`                 | Run the Vitest suite once.                                      |
| `npm run db:up`            | Start the Postgres container and wait until it is healthy.      |
| `npm run db:down`          | Stop the container (data volume preserved).                     |
| `npm run db:reset`         | Drop the volume, recreate the container, and migrate — clean.   |
| `npm run db:migrate`       | Apply pending `db/migrations/*.sql` files.                      |
| `npm run db:seed`          | Apply `db/seed.sql` inside the db container (rerunnable).       |
| `npm run jobs:expire-holds`| Expire pending bookings whose hold has passed (safe to re-run). |

The Postgres container publishes on host port **5433** to avoid colliding with
a local Postgres on 5432. A `pg_isready` healthcheck plus `--wait` on `db:up`
ensures migrations never run against a container that is not ready yet. A
cold start (empty volume) also creates `ottodot_trial_test` alongside the
primary database — see `db/docker-initdb/` — so `npm test` needs no separate
setup.

## Testing

The suite (`npm test`, Vitest) runs against a real Postgres, pointed at
`TEST_DATABASE_URL` (see `.env.example`). Each test file drops and recreates
the schema and reseeds before running, so the target must be a disposable
database — never your development database. `npm run db:reset` already
creates it (see above); the test names are written as sentences, so the run
output reads as a specification of what the system guarantees.

## Layout

- `src/lib/db.ts` — the shared `pg` pool and a `withTransaction` helper.
- `src/lib/errors.ts` — typed domain errors with stable machine-readable codes.
- `db/migrations/` — plain numbered SQL migrations.
- `db/seed.sql` — rerunnable demo/test seed (applied by `db:seed`).
- `db/invariants.sql` — zero-rows-when-healthy invariant checks.
- `db/docker-initdb/` — runs once on a cold container volume to create the
  test database alongside the primary one.
- `scripts/` — `tsx` entrypoints for migrate and jobs.
- `DEPENDENCIES.md` — why each dependency exists and what was rejected.
