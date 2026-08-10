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

/**
 * A starting catalogue. Adjust it to match the biosuits your server actually
 * ships — this is game content, which is exactly why it lives in a table an
 * admin can edit rather than in an enum that needs a deploy.
 */
const CATALOGUE: { race: 'BELLATO' | 'CORA' | 'ACCRETIA'; name: string; minLevel: number }[] = [
  { race: 'BELLATO', name: 'Warrior', minLevel: 1 },
  { race: 'BELLATO', name: 'Ranger', minLevel: 1 },
  { race: 'BELLATO', name: 'Specialist', minLevel: 1 },
  { race: 'BELLATO', name: 'Driver', minLevel: 30 },

  { race: 'CORA', name: 'Warrior', minLevel: 1 },
  { race: 'CORA', name: 'Ranger', minLevel: 1 },
  { race: 'CORA', name: 'Specialist', minLevel: 1 },
  { race: 'CORA', name: 'Spiritualist', minLevel: 1 },

  { race: 'ACCRETIA', name: 'Warrior', minLevel: 1 },
  { race: 'ACCRETIA', name: 'Ranger', minLevel: 1 },
  { race: 'ACCRETIA', name: 'Specialist', minLevel: 1 },
  { race: 'ACCRETIA', name: 'Launcher', minLevel: 30 },
]

async function main() {
  console.info('[seed] inserting biosuit catalogue')

  await db
    .insert(biosuits)
    .values(CATALOGUE.map((entry) => ({ ...entry, isActive: true })))
    .onConflictDoNothing()

  console.info(`[seed] done, ${CATALOGUE.length} entries ensured`)
  process.exit(0)
}

main().catch((error) => {
  console.error('[seed] failed', error)
  process.exit(1)
})
