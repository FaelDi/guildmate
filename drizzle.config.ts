import { defineConfig } from 'drizzle-kit'

// Migrations run DDL, which Supabase's transaction pooler (port 6543) does not
// support, so drizzle-kit prefers the direct connection when one is configured.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL

if (!url) {
  throw new Error('DIRECT_URL (or DATABASE_URL) must be set to run drizzle-kit')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
