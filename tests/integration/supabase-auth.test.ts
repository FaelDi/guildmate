import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import {
  adminCreateUser,
  refreshSession,
  signInWithPassword,
  signOut,
  verifyAccessToken,
} from '@/lib/supabase-auth'

/**
 * Live integration test against the configured Supabase project.
 *
 * Opt-in: it hits the network and creates a throwaway account in Supabase Auth,
 * which it deletes again in `afterAll`. `npm test` skips it; run it with
 * `npm run test:integration`.
 *
 * It exists because the auth layer is the one part of the system that cannot be
 * proven correct locally: whether the project signs tokens with ES256 via JWKS
 * or with a shared secret, and whether the issuer claim matches what we verify
 * against, is a property of the deployment, not of this code.
 */
const configured =
  process.env.RUN_SUPABASE_INTEGRATION === '1' &&
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY) &&
  Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)

const email = `guildmate-itest-${randomUUID()}@example.com`
const password = `Itest-${randomUUID()}`
let createdUserId: string | null = null

async function deleteUser(id: string): Promise<void> {
  const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
}

describe.skipIf(!configured)('Supabase Auth (live)', () => {
  afterAll(async () => {
    if (createdUserId) await deleteUser(createdUserId)
  })

  it('creates an account through the admin API', async () => {
    const created = await adminCreateUser({ email, password })
    expect(created).not.toBeNull()
    createdUserId = created?.supabaseUserId ?? null
    expect(createdUserId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('refuses a duplicate email without throwing', async () => {
    expect(await adminCreateUser({ email, password })).toBeNull()
  })

  it('signs in and returns a usable session', async () => {
    const session = await signInWithPassword(email, password)
    expect(session).not.toBeNull()
    expect(session?.supabaseUserId).toBe(createdUserId)
    expect(session?.expiresAt).toBeGreaterThan(Date.now())
  })

  it('rejects a wrong password', async () => {
    expect(await signInWithPassword(email, `${password}-wrong`)).toBeNull()
  })

  it('rejects an unknown email', async () => {
    expect(await signInWithPassword(`no-such-${randomUUID()}@example.com`, password)).toBeNull()
  })

  it('verifies the access token signature, issuer and expiry', async () => {
    const session = await signInWithPassword(email, password)
    const claims = await verifyAccessToken(session?.accessToken ?? '')
    // This is the assertion that matters: it proves the deployment's signing
    // mode matches the verification path the app takes on every request.
    expect(claims).not.toBeNull()
    expect(claims?.sub).toBe(createdUserId)
  })

  it('rejects a tampered token', async () => {
    const session = await signInWithPassword(email, password)
    const [header, payload, signature] = (session?.accessToken ?? '').split('.')
    const tampered = `${header}.${payload}.${(signature ?? '').slice(0, -4)}AAAA`
    expect(await verifyAccessToken(tampered)).toBeNull()
  })

  it('rejects a syntactically invalid token', async () => {
    expect(await verifyAccessToken('not-a-jwt')).toBeNull()
  })

  it('exchanges a refresh token for a new session', async () => {
    const session = await signInWithPassword(email, password)
    const refreshed = await refreshSession(session?.refreshToken ?? '')
    expect(refreshed).not.toBeNull()
    expect(refreshed?.supabaseUserId).toBe(createdUserId)
  })

  it('rejects a bogus refresh token', async () => {
    expect(await refreshSession('bogus-refresh-token')).toBeNull()
  })

  it('signs out without throwing', async () => {
    const session = await signInWithPassword(email, password)
    await expect(signOut(session?.accessToken ?? '')).resolves.toBeUndefined()
  })
})
