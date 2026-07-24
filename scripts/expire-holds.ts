import 'dotenv/config';

/**
 * Hold-expiry job entrypoint.
 *
 * Placeholder for Milestone 1: the booking/hold schema does not exist yet, so
 * there is nothing to expire. The actual job — releasing seats whose holds
 * have passed their expiry — lands with the booking logic in a later
 * milestone. The `jobs:expire-holds` script exists now so the operational
 * surface (a cron-invocable command) is fixed from the start.
 */
async function main() {
  console.log('No holds to expire yet (no booking schema in Milestone 1).');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
