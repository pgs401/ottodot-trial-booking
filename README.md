# ottodot-trial-booking

Trial class booking service with database enforced seat capacity, two phase
mock payments, and a race safe last seat claim. Next.js 14, PostgreSQL, Vitest.

## Status

Milestone 1 — project foundation only. No booking business logic yet.

## Prerequisites

- Node.js 18+ and npm
- Docker (for the local PostgreSQL 16 container)

## Getting started

```bash
cp .env.example .env      # adjust if needed
npm install
npm run db:reset          # start Postgres on host port 5433 and migrate
npm run dev               # Next.js on http://localhost:3000
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
| `npm run jobs:expire-holds`| Release expired seat holds (no-op until the schema exists).     |

The Postgres container publishes on host port **5433** to avoid colliding with
a local Postgres on 5432. A `pg_isready` healthcheck plus `--wait` on `db:up`
ensures migrations never run against a container that is not ready yet.

## Testing

The suite (`npm test`, Vitest) runs against a real Postgres, pointed at
`TEST_DATABASE_URL` (see `.env.example`). Each test file drops and recreates the
schema and reseeds before running, so the target must be an existing but
otherwise disposable database — never your development database. Create it once:

```bash
docker compose exec db createdb -U ottodot ottodot_trial_test
```

The test names are written as sentences, so the run output reads as a
specification of what the system guarantees.

## Layout

- `src/lib/db.ts` — the shared `pg` pool and a `withTransaction` helper.
- `src/lib/errors.ts` — typed domain errors with stable machine-readable codes.
- `db/migrations/` — plain numbered SQL migrations.
- `db/seed.sql` — rerunnable demo/test seed (applied by `db:seed`).
- `db/invariants.sql` — zero-rows-when-healthy invariant checks.
- `scripts/` — `tsx` entrypoints for migrate and jobs.
- `DEPENDENCIES.md` — why each dependency exists and what was rejected.
