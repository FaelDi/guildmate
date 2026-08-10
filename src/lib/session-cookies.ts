import { cookies } from 'next/headers'
import type { SupabaseSession } from './supabase-auth'

/**
 * The session lives in httpOnly cookies on THIS origin, never in localStorage
 * and never as a Supabase token the page's JavaScript can read. That is what
 * makes the Supabase project invisible to the client and takes token theft via
 * XSS off the table.
 */
export const ACCESS_TOKEN_COOKIE = 'gm_at'
export const REFRESH_TOKEN_COOKIE = 'gm_rt'

const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }
}

export async function setSessionCookies(session: SupabaseSession): Promise<void> {
  const jar = await cookies()
  const accessMaxAge = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000))

  jar.set(ACCESS_TOKEN_COOKIE, session.accessToken, {
    ...baseCookieOptions(),
    maxAge: accessMaxAge,
  })
  jar.set(REFRESH_TOKEN_COOKIE, session.refreshToken, {
    ...baseCookieOptions(),
    maxAge: REFRESH_MAX_AGE_SECONDS,
  })
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies()
  jar.set(ACCESS_TOKEN_COOKIE, '', { ...baseCookieOptions(), maxAge: 0 })
  jar.set(REFRESH_TOKEN_COOKIE, '', { ...baseCookieOptions(), maxAge: 0 })
}

export async function readAccessToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(ACCESS_TOKEN_COOKIE)?.value ?? null
}

export async function readRefreshToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(REFRESH_TOKEN_COOKIE)?.value ?? null
}
