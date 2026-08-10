import 'server-only'

/**
 * Best-effort in-process rate limiter.
 *
 * IMPORTANT: this counts per serverless instance, not globally, so a burst
 * spread across cold starts can exceed the nominal limit. It is a cheap first
 * line of defence, not a guarantee. Anything that must hold globally (login
 * attempts, event-code guessing) is ALSO enforced in the database - the
 * per-account lockout on `users` and the per-event unique index. Swap this for
 * Upstash Redis when a hard global limit is required.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_TRACKED_KEYS = 10_000

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number }

export function rateLimit(params: {
  key: string
  limit: number
  windowMs: number
  now?: number
}): RateLimitResult {
  const now = params.now ?? Date.now()
  const existing = buckets.get(params.key)

  if (!existing || existing.resetAt <= now) {
    // Cheap eviction so a long-lived instance cannot grow unbounded.
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key)
      }
      if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear()
    }
    const resetAt = now + params.windowMs
    buckets.set(params.key, { count: 1, resetAt })
    return { allowed: true, remaining: params.limit - 1, resetAt }
  }

  existing.count += 1
  return {
    allowed: existing.count <= params.limit,
    remaining: Math.max(0, params.limit - existing.count),
    resetAt: existing.resetAt,
  }
}

/** Test seam: drops all counters. */
export function resetRateLimits(): void {
  buckets.clear()
}
