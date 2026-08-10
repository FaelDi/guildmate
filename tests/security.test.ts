import { describe, expect, it, beforeEach } from 'vitest'
import { redact } from '@/lib/redact'
import {
  generateEventCode,
  hashEventCode,
  hashSecret,
  normalizeEventCode,
  verifyEventCode,
  verifySecret,
} from '@/lib/crypto'
import { rateLimit, resetRateLimits } from '@/lib/rate-limit'
import { buildObjectKey, parseObjectKey } from '@/lib/supabase'

describe('password hashing', () => {
  it('verifies a correct secret and rejects a wrong one', async () => {
    const digest = await hashSecret('correct horse battery staple')
    expect(await verifySecret('correct horse battery staple', digest)).toBe(true)
    expect(await verifySecret('wrong password', digest)).toBe(false)
  })

  it('salts, so the same input never produces the same digest twice', async () => {
    const [a, b] = await Promise.all([hashSecret('same'), hashSecret('same')])
    expect(a).not.toBe(b)
  })

  it('returns false instead of throwing on a malformed digest', async () => {
    for (const digest of ['', 'nonsense', 'scrypt$1', 'bcrypt$a$b$c$d$e', 'scrypt$x$y$z$q$w']) {
      expect(await verifySecret('anything', digest)).toBe(false)
    }
  })
})

describe('event codes', () => {
  it('uses an alphabet free of ambiguous characters', () => {
    const code = generateEventCode(200)
    expect(code).not.toMatch(/[OI01]/)
    expect(code).toHaveLength(200)
  })

  it('normalizes case and separators players type', () => {
    expect(normalizeEventCode(' ab-cd ef ')).toBe('ABCDEF')
  })

  it('verifies a code regardless of how it was typed', async () => {
    const digest = await hashEventCode('AB2K9XZQ')
    expect(await verifyEventCode('ab2k9xzq', digest)).toBe(true)
    expect(await verifyEventCode('AB2K-9XZQ', digest)).toBe(true)
    expect(await verifyEventCode('AB2K9XZR', digest)).toBe(false)
  })
})

describe('storage object keys', () => {
  const guildId = '11111111-1111-1111-1111-111111111111'
  const userId = '22222222-2222-2222-2222-222222222222'
  const objectId = '33333333-3333-3333-3333-333333333333'

  it('round-trips a well-formed key', () => {
    const key = buildObjectKey({ guildId, userId, objectId, extension: 'png' })
    expect(parseObjectKey(key)).toEqual({ guildId, ownerUserId: userId })
  })

  it('rejects path traversal', () => {
    expect(parseObjectKey(`guild/${guildId}/user/${userId}/../../../etc/passwd`)).toBeNull()
    expect(parseObjectKey('../../secrets.png')).toBeNull()
  })

  it('rejects absolute paths and doubled separators', () => {
    expect(parseObjectKey(`/guild/${guildId}/user/${userId}/${objectId}.png`)).toBeNull()
    expect(parseObjectKey(`guild//${guildId}/user/${userId}/${objectId}.png`)).toBeNull()
  })

  it('rejects a disallowed extension', () => {
    expect(parseObjectKey(`guild/${guildId}/user/${userId}/${objectId}.svg`)).toBeNull()
    expect(parseObjectKey(`guild/${guildId}/user/${userId}/${objectId}.html`)).toBeNull()
  })

  it('rejects a key that is not the exact shape this app writes', () => {
    expect(parseObjectKey(`guild/${guildId}/${objectId}.png`)).toBeNull()
    expect(parseObjectKey(`other/${guildId}/user/${userId}/${objectId}.png`)).toBeNull()
  })
})

describe('audit redaction', () => {
  it('strips secrets at any depth', () => {
    const redacted = redact({
      email: 'player@example.com',
      password: 'hunter2',
      nested: { codeHash: 'abc', joinCode: 'AB2K9XZQ', level: 55 },
      list: [{ token: 'xyz' }],
    }) as Record<string, unknown>

    expect(redacted.email).toBe('player@example.com')
    expect(redacted.password).toBe('[REDACTED]')
    expect((redacted.nested as Record<string, unknown>).codeHash).toBe('[REDACTED]')
    expect((redacted.nested as Record<string, unknown>).joinCode).toBe('[REDACTED]')
    expect((redacted.nested as Record<string, unknown>).level).toBe(55)
    expect((redacted.list as Record<string, unknown>[])[0]?.token).toBe('[REDACTED]')
  })

  it('passes primitives through untouched', () => {
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
  })
})

describe('rate limiter', () => {
  beforeEach(() => resetRateLimits())

  it('allows up to the limit and blocks beyond it', () => {
    const params = { key: 'k', limit: 3, windowMs: 1000, now: 1_000 }
    expect(rateLimit(params).allowed).toBe(true)
    expect(rateLimit(params).allowed).toBe(true)
    expect(rateLimit(params).allowed).toBe(true)
    expect(rateLimit(params).allowed).toBe(false)
  })

  it('resets once the window rolls over', () => {
    expect(rateLimit({ key: 'k', limit: 1, windowMs: 1000, now: 1_000 }).allowed).toBe(true)
    expect(rateLimit({ key: 'k', limit: 1, windowMs: 1000, now: 1_500 }).allowed).toBe(false)
    expect(rateLimit({ key: 'k', limit: 1, windowMs: 1000, now: 2_500 }).allowed).toBe(true)
  })

  it('tracks keys independently', () => {
    expect(rateLimit({ key: 'a', limit: 1, windowMs: 1000, now: 1_000 }).allowed).toBe(true)
    expect(rateLimit({ key: 'b', limit: 1, windowMs: 1000, now: 1_000 }).allowed).toBe(true)
  })
})
