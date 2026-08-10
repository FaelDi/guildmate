import 'server-only'
import '@/lib/runtime-guards'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { parseConnectionString } from '@/lib/connection-string'
import * as schema from './schema'

const connectionString = parseConnectionString(process.env.DATABASE_URL)

/**
 * Supabase Postgres over the transaction pooler.
 *
 * The `server-only` import above is load bearing: it turns any accidental
 * import from a client component into a build error, which is what keeps the
 * database credentials out of the browser bundle.
 *
 * Serverless functions are short lived and highly concurrent, so each instance
 * keeps a single socket. Prepared statements are disabled because Supabase's
 * transaction pooler (port 6543) does not support them.
 */
const globalForDb = globalThis as unknown as { __guildmateSql?: postgres.Sql }

const sql =
  globalForDb.__guildmateSql ??
  postgres(connectionString, { max: 1, prepare: false, idle_timeout: 20 })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__guildmateSql = sql
}

export const db = drizzle(sql, { schema })

export type Database = typeof db
/** The handle passed to callbacks inside `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
/** Anything that can run queries: the pool or an open transaction. */
export type Executor = Database | Transaction

export { schema }
