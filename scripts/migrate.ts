import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Minimal forward-only migration runner.
 *
 * Applies every `db/migrations/NNNN_*.sql` file, in filename order, exactly
 * once. Applied filenames are recorded in a `schema_migrations` ledger so
 * re-running is a no-op. Each file runs inside its own transaction, so a
 * failing migration leaves no partial state and is retried next run.
 *
 * We roll our own instead of pulling in a migration framework: the whole need
 * here is "run these ordered SQL files once, in a transaction, and remember
 * which ran." That is a handful of lines against `pg`. A framework would add a
 * dependency, its own config, and a DSL to learn — all to hide plain SQL that
 * we want to read and review directly.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text        PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied = new Set(
      (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations'))
        .rows.map((r) => r.filename),
    );

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed: ${file}\n${(err as Error).message}`);
      } finally {
        client.release();
      }

      console.log(`applied ${file}`);
      ran += 1;
    }

    console.log(ran === 0 ? 'No pending migrations.' : `Applied ${ran} migration(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
