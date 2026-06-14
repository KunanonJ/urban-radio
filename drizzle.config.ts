import { defineConfig } from 'drizzle-kit';

// Drizzle config for the Railway/Postgres mirror of the D1 schema.
// `src/db/schema.ts` defines the Postgres tables; `drizzle-kit generate`
// emits the migration SQL into `src/db/migrations/`. The connection URL
// is required only for `drizzle-kit push` / `drizzle-kit migrate` —
// `generate` runs purely off the TS schema.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/sonic_bloom_dev',
  },
  strict: true,
  verbose: true,
});
