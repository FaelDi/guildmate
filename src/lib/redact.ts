/** Keys whose values must never reach the audit trail. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'code',
  'codehash',
  'codelookup',
  'joincode',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
])

/**
 * Strips secrets from a snapshot before it is persisted. The audit log is read
 * by every admin, so it must never become a place where an event code, a token
 * or a password hash leaks.
 *
 * Kept free of imports so it stays a pure, directly testable function.
 */
export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map(redact)

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
    out[key] = REDACTED_KEYS.has(normalized) ? '[REDACTED]' : redact(val)
  }
  return out
}
