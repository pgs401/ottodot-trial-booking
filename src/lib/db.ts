import { Pool, type PoolClient } from 'pg';

/**
 * A single, process-wide connection pool.
 *
 * One pool is shared by the whole app: pg queues queries onto pooled
 * connections, so creating more than one pool would fragment the connection
 * budget and defeat that pooling. Export the instance rather than a factory
 * so every caller provably talks to the same pool.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Run `fn` inside a single database transaction.
 *
 * The pooled client is passed *into* the callback and is the only handle the
 * callback receives. This is deliberate: the caller cannot reach for
 * `pool.query(...)` and accidentally run a statement on a different pooled
 * connection outside the transaction — every statement in `fn` must go through
 * the `client` argument, which is the one that holds the open transaction.
 *
 * BEGIN is issued up front; COMMIT on success; ROLLBACK if `fn` throws (the
 * original error is re-thrown). The client is always returned to the pool.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
