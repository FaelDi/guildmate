/**
 * The RF Online Next biosuit roster.
 *
 * Two things changed from the 2004 game and both matter here:
 *
 * 1. The old race-locked classes (Warrior / Ranger / Specialist plus a racial
 *    fourth) are gone. RF Next ships eight biosuits and a player switches
 *    between them, so the catalogue is seeded for all three nations rather
 *    than split by race.
 * 2. Only the names are settled. Netmarble publishes the roster but not a
 *    stable per-suit level requirement, so nothing here invents one - a guild
 *    that wants gates edits the `biosuits` table, which is exactly why the
 *    catalogue is a table and not an enum.
 *
 * Source: https://rfonlinenextgb.netmarble.com/en/gameinfo/biosuit
 */
export const RF_NEXT_BIOSUITS = [
  'Arbiter',
  'Demolisher',
  'Dreadnought',
  'Enforcer',
  'Phantom',
  'Psypher',
  'Punisher',
  'Technician',
] as const

export type BiosuitName = (typeof RF_NEXT_BIOSUITS)[number]
