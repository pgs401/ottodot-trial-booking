import 'dotenv/config';

/**
 * Seed entrypoint.
 *
 * Placeholder for Milestone 1: there is no domain schema to seed yet, so this
 * intentionally does nothing beyond confirming the entrypoint runs. Seed data
 * (classes, seats) arrives with the schema in a later milestone. The `db:seed`
 * script exists now so the command surface is stable from the start.
 */
async function main() {
  console.log('Nothing to seed yet (no domain schema in Milestone 1).');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
