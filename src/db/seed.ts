/**
 * Seeds the biosuit catalogue.
 *
 * Deliberately does NOT create guilds, members or events: accounts must be
 * created through Supabase Auth so the credential and the domain row stay in
 * sync. Use the "Create a guild" screen for the first leader.
 *
 * Run with: npm run db:seed
 */
import { db } from './index'
import { biosuits } from './schema'
import { RF_NEXT_BIOSUITS } from '../lib/biosuits'

const RACES = ['BELLATO', 'CORA', 'ACCRETIA'] as const

/**
 * Every suit for every nation. RF Next unlocked biosuits across the three
 * races, so a per-race catalogue would be wrong; the table stays race-scoped
 * only because a guild may want to restrict a suit for its own reasons.
 */
const CATALOGUE = RACES.flatMap((race) =>
  RF_NEXT_BIOSUITS.map((name) => ({ race, name, minLevel: 1, isActive: true })),
)

async function main() {
  console.info('[seed] inserting biosuit catalogue')

  await db.insert(biosuits).values(CATALOGUE).onConflictDoNothing()

  console.info(`[seed] done, ${CATALOGUE.length} entries ensured`)
  process.exit(0)
}

main().catch((error) => {
  console.error('[seed] failed', error)
  process.exit(1)
})
