# Dependencies and decisions

Every dependency added beyond the `create-next-app` scaffold is listed here
with a one-line justification and the alternative that was rejected. If a line
below stops being true, the dependency should be removed.

## Runtime dependencies

- **pg** — direct PostgreSQL driver; gives us raw SQL and explicit
  transactions/`SELECT ... FOR UPDATE`, which the race-safe last-seat claim
  needs. _Rejected:_ `postgres` (porsager) — fine library, but `pg` is the
  most widely deployed driver and its client/pool model maps cleanly onto our
  `withTransaction` helper.
- **zod** — runtime validation of untrusted input (request bodies, env) with
  types inferred from the schema, so validation and TypeScript types can't
  drift. _Rejected:_ hand-written type guards (unsafe, verbose) and
  class-validator (decorator/reflect-metadata baggage).
- **dotenv** — loads `.env` into `process.env` for the standalone `tsx`
  scripts (migrate/seed/jobs) that run outside Next.js's own env loading.
  _Rejected:_ relying on Next.js env loading (it doesn't apply to plain node
  scripts) and env-schema libraries (zod already covers validation).

## Dev dependencies

- **vitest** — test runner with native TypeScript/ESM support and zero config,
  so tests run the same way our `tsx` scripts do. _Rejected:_ Jest (needs
  ts-jest/babel transform config for TS+ESM) and node:test (thinner assertion
  and mocking story).
- **tsx** — runs the TypeScript migrate/seed/job scripts directly, no build
  step. _Rejected:_ `ts-node` (slower, heavier ESM config) and precompiling
  with `tsc` (adds an artifact directory and a build step for one-shot
  scripts).
- **@types/pg** — type definitions for `pg`, which ships untyped. _Rejected:_
  nothing to reject; it is the canonical types package for `pg`.

## Why no ORM

The core of this service is a race-safe seat claim that depends on precise SQL
— row locks, conditional updates, unique constraints, `RETURNING`. An ORM
(Prisma, TypeORM, Drizzle) would sit between us and exactly the SQL semantics
we most need to control, and would add a schema DSL, a client generator, and
migration tooling on top. Plain `pg` with SQL we can read and review is the
right altitude for this problem.

## Why no test-database helper library

Test isolation here is just "point at `TEST_DATABASE_URL`, migrate, truncate
between tests." That is a few lines of our own SQL/setup — it does not warrant
a dependency like `@databases/pg-test`, testcontainers, or `pg-mem`.
testcontainers adds Docker orchestration we already handle with
`docker-compose`, and `pg-mem` reimplements Postgres in JS and would not
faithfully reproduce the locking behaviour our tests must verify.

## Why plain numbered SQL migrations (no framework)

Migrations are `db/migrations/NNNN_*.sql` applied once, in order, by
`scripts/migrate.ts` (~60 lines). A framework (node-pg-migrate, Flyway,
Prisma Migrate) would add a dependency, its own config, and a DSL to learn, all
to wrap SQL we want to read directly. The runner records applied files in a
`schema_migrations` ledger and runs each file in a transaction — enough for a
forward-only workflow.

## Why no extra ESLint/Prettier config

We keep exactly what `create-next-app` scaffolds (`eslint-config-next` via
`.eslintrc.json`) and add nothing. Next's config already covers the framework's
rules; adding Prettier or a custom ESLint ruleset now would be bikeshedding
configuration before there is code to style, and would risk fighting Next's
defaults. Formatting conventions can be revisited when the team actually needs
them.
