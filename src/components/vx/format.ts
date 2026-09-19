/** Display helpers shared by the command-center screens. Pure, client-safe. */

const NUMBER = new Intl.NumberFormat('pt-BR')

/** 201247 -> "201.247", the way the guild reads combat power. */
export function formatNumber(value: number): string {
  return NUMBER.format(value)
}

/** 97.4359 -> "97.4%". One decimal, always. */
export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

/** Fills `{name}` placeholders in a dictionary string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}

const BRT_OFFSET_MS = -3 * 3_600_000

/** "19/09 21:30" in Brasilia time, whatever the viewer's timezone. */
export function formatBrt(at: Date | string | number): string {
  const brt = new Date(new Date(at).getTime() + BRT_OFFSET_MS)
  const dd = String(brt.getUTCDate()).padStart(2, '0')
  const mm = String(brt.getUTCMonth() + 1).padStart(2, '0')
  const hh = String(brt.getUTCHours()).padStart(2, '0')
  const mi = String(brt.getUTCMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${mi}`
}

/** "00:00:00" countdown pieces from a millisecond difference. */
export function splitDuration(diffMs: number) {
  const safe = Math.max(0, diffMs)
  return {
    days: Math.floor(safe / 86_400_000),
    hours: Math.floor((safe % 86_400_000) / 3_600_000),
    minutes: Math.floor((safe % 3_600_000) / 60_000),
    seconds: Math.floor((safe % 60_000) / 1000),
  }
}

export const pad2 = (n: number) => String(n).padStart(2, '0')

/** The eight RF Next classes, in the order the guild lists them. */
export const CLASSES = [
  'Punisher',
  'Phantom',
  'Enforcer',
  'Psypher',
  'Dreadnought',
  'Technician',
  'Arbiter',
  'Demolisher',
] as const
