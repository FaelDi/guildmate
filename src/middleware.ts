import { NextResponse, type NextRequest } from 'next/server'

/**
 * Keeps the access token fresh.
 *
 * This runs on the edge runtime, so it deliberately does NOT touch the
 * database or import the domain layer. It has exactly one job: when the access
 * token is missing or about to expire and a refresh token is present, exchange
 * it server-side and rewrite the cookies. Authorization is not decided here -
 * that happens in `requireSession()`, against the live database row.
 */

const ACCESS_TOKEN_COOKIE = 'gm_at'
const REFRESH_TOKEN_COOKIE = 'gm_rt'
/** Refresh this many seconds before the token actually expires. */
const REFRESH_SKEW_SECONDS = 120

/** Reads `exp` without verifying. Only used to decide *when* to refresh. */
function readExpiry(token: string): number | null {
  const segment = token.split('.')[1]
  if (!segment) return null
  try {
    const json = atob(segment.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: number }).exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value

  if (!refreshToken) return NextResponse.next()

  if (accessToken) {
    const exp = readExpiry(accessToken)
    if (exp && exp - REFRESH_SKEW_SECONDS > Math.floor(Date.now() / 1000)) {
      return NextResponse.next()
    }
  }

  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY
  if (!url || !publishableKey) return NextResponse.next()

  try {
    const upstream = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    })

    const response = NextResponse.next()
    const secure = process.env.NODE_ENV === 'production'

    if (!upstream.ok) {
      // The refresh token is spent or revoked: drop both cookies so the user
      // lands on the sign-in page instead of looping on a dead session.
      response.cookies.set(ACCESS_TOKEN_COOKIE, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 })
      response.cookies.set(REFRESH_TOKEN_COOKIE, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 })
      return response
    }

    const body = (await upstream.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!body.access_token || !body.refresh_token) return NextResponse.next()

    response.cookies.set(ACCESS_TOKEN_COOKIE, body.access_token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.max(60, body.expires_in ?? 3600),
    })
    response.cookies.set(REFRESH_TOKEN_COOKIE, body.refresh_token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    // Make the new token visible to the very request that triggered the
    // refresh, so this page load is not treated as signed out.
    request.cookies.set(ACCESS_TOKEN_COOKIE, body.access_token)
    return response
  } catch (error) {
    console.error('[middleware] token refresh failed', error)
    return NextResponse.next()
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)'],
}
