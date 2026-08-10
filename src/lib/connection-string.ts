/**
 * Reading a Postgres connection string out of the environment.
 *
 * The value arrives from two places that disagree about syntax. A `.env` file
 * is parsed, so `DATABASE_URL="postgres://..."` yields just the URL. A hosting
 * dashboard takes the field literally, so pasting that same line stores the
 * variable name and the quotes as part of the value - and the driver then dies
 * with `TypeError: Invalid URL` at build time, pointing at a stack frame in a
 * bundled chunk that says nothing about what is wrong.
 *
 * Stripping the wrapper is not being lenient with garbage: it is accepting the
 * one shape every dashboard produces from a correct copy-paste. Anything still
 * unparseable fails loudly, naming the variable and the expected form, and
 * never echoing the value - it carries the database password.
 */

const VARIABLE_PREFIX = /^[A-Z_][A-Z0-9_]*\s*=\s*/i
const WRAPPING_QUOTES = /^(['"])([\s\S]*)\1$/
const PSQL_PREFIX = /^psql\s+/i

export function normalizeConnectionString(raw: string): string {
  let value = raw.trim()
  value = value.replace(PSQL_PREFIX, '').trim()
  value = value.replace(VARIABLE_PREFIX, '').trim()

  const unquoted = WRAPPING_QUOTES.exec(value)
  if (unquoted?.[2] !== undefined) value = unquoted[2].trim()

  return value
}

export function parseConnectionString(raw: string | undefined, variable = 'DATABASE_URL'): string {
  if (!raw || raw.trim() === '') {
    throw new Error(`${variable} is not set. See .env.example.`)
  }

  const value = normalizeConnectionString(raw)

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(
      `${variable} is not a valid connection string. Paste only the URL - no variable name, ` +
        'no surrounding quotes - in the form ' +
        'postgresql://user:password@host:6543/postgres',
    )
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(
      `${variable} must be a postgresql:// URL. Got "${url.protocol}//" - the Supabase project ` +
        'URL (https://<ref>.supabase.co) is the API endpoint, not the database.',
    )
  }

  return value
}
