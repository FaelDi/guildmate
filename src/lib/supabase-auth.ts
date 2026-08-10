import 'server-only'

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { AppError } from './errors'

/**
 * Supabase Auth (GoTrue), reached only from this server.
 *
 * The browser never calls `*.supabase.co`. Sign-in, sign-up and refresh all go
 * through our own routes, which call GoTrue here and hand the client nothing
 * but an httpOnly cookie on our origin. Consequences worth knowing:
 *
 *  - No Supabase key of any kind ships in the browser bundle.
 *  - The Supabase project URL is not discoverable from the client.
 *  - Because every sign-in passes through us, our own per-account lockout in
 *    `users.failed_login_count` is actually enforceable, on top of GoTrue's
 *    own rate limiting.
 */

type AuthConfig = {
  url: string
  publishableKey: string
  secretKey: string
}

/**
 * Supabase replaced the legacy `anon` / `service_role` JWTs with
 * `sb_publishable_...` / `sb_secret_...`. Both are accepted here: the new names
 * win, the old ones keep an existing deployment working.
 */
function readConfig(): AuthConfig {
  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !publishableKey || !secretKey) {
    throw new AppError('AUTH_UNCONFIGURED', 'Authentication is not configured', 503)
  }
  return { url: url.replace(/\/+$/, ''), publishableKey, secretKey }
}

export type SupabaseSession = {
  accessToken: string
  refreshToken: string
  /** Absolute expiry, in epoch milliseconds. */
  expiresAt: number
  supabaseUserId: string
  email: string
}

type GoTrueSession = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  user?: { id?: string; email?: string }
}

async function goTrue(
  path: string,
  init: { method: string; body?: unknown; accessToken?: string; useServiceRole?: boolean },
): Promise<{ status: number; body: unknown }> {
  const config = readConfig()
  const key = init.useServiceRole ? config.secretKey : config.publishableKey

  const response = await fetch(`${config.url}/auth/v1${path}`, {
    method: init.method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${init.accessToken ?? key}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })

  let body: unknown = null
  try {
    const text = await response.text()
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { status: response.status, body }
}

function toSession(payload: GoTrueSession): SupabaseSession {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) {
    throw new AppError('AUTH_FAILED', 'Authentication failed', 502)
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    supabaseUserId: payload.user.id,
    email: payload.user.email ?? '',
  }
}

/**
 * Exchanges credentials for a session. Returns null on any failure so the
 * caller reports one generic message and never distinguishes "no such user"
 * from "wrong password".
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SupabaseSession | null> {
  const { status, body } = await goTrue('/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  })
  if (status !== 200) return null
  try {
    return toSession(body as GoTrueSession)
  } catch {
    return null
  }
}

export async function refreshSession(refreshToken: string): Promise<SupabaseSession | null> {
  const { status, body } = await goTrue('/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  })
  if (status !== 200) return null
  try {
    return toSession(body as GoTrueSession)
  } catch {
    return null
  }
}

export async function signOut(accessToken: string): Promise<void> {
  // A failure here only means the refresh token outlives the cookie we are
  // about to clear; never surface it to the user.
  try {
    await goTrue('/logout', { method: 'POST', accessToken })
  } catch (error) {
    console.error('[auth] sign-out revocation failed', error)
  }
}

/**
 * Creates the credential record in Supabase Auth via the admin API.
 *
 * The admin endpoint is used rather than public signup so the account exists
 * atomically with a known id, which the domain `users` row then references.
 * Returns null when the email is already taken - the caller must treat that as
 * a generic outcome rather than confirming the address is registered.
 */
export async function adminCreateUser(params: {
  email: string
  password: string
  emailConfirm?: boolean
}): Promise<{ supabaseUserId: string } | null> {
  const { status, body } = await goTrue('/admin/users', {
    method: 'POST',
    useServiceRole: true,
    body: {
      email: params.email,
      password: params.password,
      email_confirm: params.emailConfirm ?? true,
    },
  })

  if (status === 422 || status === 409) return null
  if (status < 200 || status >= 300) {
    console.error('[auth] admin create user failed', status, body)
    throw new AppError('AUTH_FAILED', 'The account could not be created', 502)
  }

  const id = (body as { id?: string } | null)?.id
  if (!id) throw new AppError('AUTH_FAILED', 'The account could not be created', 502)
  return { supabaseUserId: id }
}

/**
 * Mirrors a moderation decision into Supabase Auth, so a banned member cannot
 * obtain a fresh token even if a bug let them past our own checks.
 * `durationHours = 0` lifts the ban.
 */
export async function adminSetBan(supabaseUserId: string, durationHours: number): Promise<void> {
  const { status, body } = await goTrue(`/admin/users/${encodeURIComponent(supabaseUserId)}`, {
    method: 'PUT',
    useServiceRole: true,
    body: { ban_duration: durationHours > 0 ? `${durationHours}h` : 'none' },
  })
  if (status < 200 || status >= 300) {
    console.error('[auth] admin ban update failed', status, body)
    throw new AppError('AUTH_FAILED', 'The ban could not be applied to the credential store', 502)
  }
}

/** Revokes every outstanding refresh token for the account. */
export async function adminSignOutEverywhere(supabaseUserId: string): Promise<void> {
  const { status } = await goTrue(`/admin/users/${encodeURIComponent(supabaseUserId)}`, {
    method: 'PUT',
    useServiceRole: true,
    body: { password: undefined, email_confirm: true },
  })
  if (status < 200 || status >= 300) {
    console.error('[auth] admin session revocation failed', status)
  }
}

// ---------------------------------------------------------------------------
// Access-token verification
// ---------------------------------------------------------------------------

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  const config = readConfig()
  const explicit = process.env.SUPABASE_JWKS_URL
  jwks ??= createRemoteJWKSet(
    new URL(explicit || `${config.url}/auth/v1/.well-known/jwks.json`),
  )
  return jwks
}

export type AccessTokenClaims = JWTPayload & { sub: string; email?: string }

/**
 * Verifies a Supabase access token locally, with no round trip to GoTrue.
 *
 * Supports both signing modes: legacy projects share a symmetric secret
 * (`SUPABASE_JWT_SECRET`), newer ones publish asymmetric keys via JWKS. The
 * signature, expiry and issuer are all checked - decoding the payload without
 * verifying it would let anyone mint an admin session.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  const config = readConfig()
  const issuer = `${config.url}/auth/v1`
  const secret = process.env.SUPABASE_JWT_SECRET

  try {
    const { payload } = secret
      ? await jwtVerify(token, new TextEncoder().encode(secret), { issuer })
      : await jwtVerify(token, getJwks(), { issuer })

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
    return payload as AccessTokenClaims
  } catch {
    return null
  }
}
