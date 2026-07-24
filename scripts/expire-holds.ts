import 'dotenv/config';
import { pool } from '../src/lib/db';
import { expireStaleHolds } from '../src/domain/holds.service';

async function main() {
  const expired = await expireStaleHolds(pool);
  console.log(`expired ${expired} stale hold(s)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
