import { describe, expect, it, beforeEach, vi } from 'vitest'
import { registerSchema } from '@/lib/account-schemas'
import { parseConnectionString } from '@/lib/connection-string'
import { AppError, describeError, runAction } from '@/lib/errors'
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

describe('connection string parsing', () => {
  const url = 'postgresql://postgres.abc:s3cr3t@aws-0-us-east-1.pooler.supabase.com:6543/postgres'

  it('accepts the URL as a dashboard field takes it', () => {
    expect(parseConnectionString(url)).toBe(url)
  })

  it('survives a .env line pasted whole into a dashboard field', () => {
    // What every hosting panel receives when somebody copies the block the
    // Supabase "Connect" dialog shows.
    expect(parseConnectionString(`DATABASE_URL="${url}"`)).toBe(url)
    expect(parseConnectionString(`DIRECT_URL='${url}'`)).toBe(url)
    expect(parseConnectionString(`  "${url}"  `)).toBe(url)
    expect(parseConnectionString(`psql ${url}`)).toBe(url)
  })

  it('keeps query parameters the dialog appends', () => {
    const withParams = `${url}?pgbouncer=true&connection_limit=1`
    expect(parseConnectionString(`DATABASE_URL="${withParams}"`)).toBe(withParams)
  })

  it('refuses an unset variable by name', () => {
    expect(() => parseConnectionString(undefined)).toThrow(/DATABASE_URL is not set/)
    expect(() => parseConnectionString('   ')).toThrow(/DATABASE_URL is not set/)
    expect(() => parseConnectionString(undefined, 'DIRECT_URL')).toThrow(/DIRECT_URL is not set/)
  })

  it('says what a valid one looks like instead of throwing Invalid URL', () => {
    expect(() => parseConnectionString('not a url at all')).toThrow(/postgresql:\/\/user:password@host/)
  })

  it('catches the Supabase API endpoint being used as the database', () => {
    expect(() => parseConnectionString('https://abc.supabase.co')).toThrow(/API endpoint, not the database/)
  })

  it('never echoes the value, because it carries the password', () => {
    try {
      parseConnectionString('postgresql://user:hunter2@')
      throw new Error('should have refused')
    } catch (error) {
      expect(String(error)).not.toContain('hunter2')
    }
  })
})

describe('action error reporting', () => {
  /** Shaped like a postgres.js error: a query the server itself rejected. */
  function postgresError(overrides: Record<string, unknown> = {}): Error {
    return Object.assign(new Error('relation "guilds" does not exist'), {
      name: 'PostgresError',
      code: '42P01',
      severity: 'ERROR',
      routine: 'parserOpenTable',
      ...overrides,
    })
  }

  it('names the Postgres code, table and constraint that failed', () => {
    const report = describeError(
      postgresError({ code: '23505', table_name: 'characters', constraint_name: 'characters_guild_name_key' }),
    )
    expect(report.errorCode).toBe('23505')
    expect(report.postgres?.table).toBe('characters')
    expect(report.postgres?.constraint).toBe('characters_guild_name_key')
  })

  it('omits the Postgres block for an error the driver never reached the server with', () => {
    const report = describeError(Object.assign(new Error('getaddrinfo ENOTFOUND db.example'), { code: 'ENOTFOUND' }))
    expect(report.errorCode).toBe('ENOTFOUND')
    expect(report.postgres).toBeUndefined()
  })

  it('describes a throwable that is not an Error at all', () => {
    expect(describeError('boom')).toEqual({ name: 'NonError', message: 'boom' })
  })

  it('follows the cause chain', () => {
    const error = new Error('outer', { cause: postgresError() })
    expect(describeError(error).cause?.errorCode).toBe('42P01')
  })

  it('never copies an arbitrary property off the error, so a secret cannot ride along', () => {
    const report = describeError(
      Object.assign(new Error('connection failed'), {
        code: 'ECONNREFUSED',
        password: 'hunter2',
        connectionString: 'postgresql://user:hunter2@host:5432/postgres',
      }),
    )
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('postgresql://')
    expect(report.errorCode).toBe('ECONNREFUSED')
  })

  it('passes an AppError message through untouched', async () => {
    const result = await runAction(async () => {
      throw new AppError('GUILD_EXISTS', 'A guild with that name already exists')
    })
    expect(result).toEqual({
      ok: false,
      code: 'GUILD_EXISTS',
      message: 'A guild with that name already exists',
    })
  })

  it('reports an unreachable database as a temporary outage, not a generic bug', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runAction(async () => {
      throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    })
    spy.mockRestore()

    expect(!result.ok && result.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('hides a rejected query behind the generic message but logs what it was', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runAction(async () => {
      throw postgresError()
    })
    const [prefix, payload] = spy.mock.calls[0] ?? []
    spy.mockRestore()

    expect(!result.ok && result.code).toBe('INTERNAL_ERROR')
    expect(!result.ok && result.message).toBe('Something went wrong. Try again.')

    // The operator gets, as one parseable line, exactly what the user must not.
    expect(prefix).toBe('[action] unhandled error')
    const logged = JSON.parse(String(payload))
    expect(logged.errorCode).toBe('42P01')
    expect(logged.message).toBe('relation "guilds" does not exist')
    expect(logged.postgres.routine).toBe('parserOpenTable')
  })
})

describe('sign-up input', () => {
  const base = {
    email: 'player@example.com',
    password: 'longenough123',
    characterName: 'piradinhu90',
    race: 'CORA',
    biosuit: 'Arbiter',
    level: 56,
    kind: 'ALT',
  }

  it('accepts a recruitment sign-up that posts no guild slug at all', () => {
    expect(registerSchema.parse(base).guildSlug).toBeUndefined()
  })

  it('treats the empty slug an unfilled form field submits as absent, not malformed', () => {
    expect(registerSchema.parse({ ...base, guildSlug: '' }).guildSlug).toBeUndefined()
  })

  it('keeps accepting a directory sign-up that names its guild', () => {
    expect(registerSchema.parse({ ...base, guildSlug: 'iron-vanguard' }).guildSlug).toBe(
      'iron-vanguard',
    )
  })

  it('still refuses a malformed slug when one is given', () => {
    expect(() => registerSchema.parse({ ...base, guildSlug: 'x' })).toThrow()
  })
})
