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
| `npm run db:seed`          | Seed development data (no-op until the schema exists).          |
| `npm run jobs:expire-holds`| Release expired seat holds (no-op until the schema exists).     |

The Postgres container publishes on host port **5433** to avoid colliding with
a local Postgres on 5432. A `pg_isready` healthcheck plus `--wait` on `db:up`
ensures migrations never run against a container that is not ready yet.

## Layout

- `src/lib/db.ts` — the shared `pg` pool and a `withTransaction` helper.
- `src/lib/errors.ts` — typed domain errors with stable machine-readable codes.
- `db/migrations/` — plain numbered SQL migrations.
- `scripts/` — `tsx` entrypoints for migrate, seed, and jobs.
- `DEPENDENCIES.md` — why each dependency exists and what was rejected.
