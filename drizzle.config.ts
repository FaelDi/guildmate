import { loadEnvConfig } from '@next/env'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs outside Next, so nothing has loaded `.env.local` yet. Using
// Next's own loader rather than a hand-rolled one keeps the precedence
// identical to the running app (.env.local wins over .env), so a migration can
// never target a different database than the one the app talks to.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error })

// Migrations run DDL, which Supabase's transaction pooler (port 6543) does not
// support, so drizzle-kit prefers the direct connection when one is configured.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL

if (!url) {
  throw new Error(
    'DIRECT_URL (or DATABASE_URL) must be set to run drizzle-kit. ' +
      'Add it to .env.local — see .env.example.',
  )
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
