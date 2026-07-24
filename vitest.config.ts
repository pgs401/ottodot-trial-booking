import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The four files share one real Postgres database and each drops and
    // reseeds the schema, so they must not run at the same time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    // Print every test name so `npm test` output reads as a specification of
    // what the system promises, not just a file/pass count.
    reporters: ['verbose'],
  },
});
