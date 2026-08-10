import 'server-only'

import { cache } from 'react'
import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { guildSettings, users, type User } from '@/db/schema'
import { fingerprint } from './crypto'
import { AppError, failureToError } from './errors'
import { loadRestrictions } from './restrictions'
import { readAccessToken } from './session-cookies'
import { verifyAccessToken } from './supabase-auth'
import {
  evaluateAccountAccess,
  isGuildAdmin,
  type Actor,
  type RestrictionLike,
  type SettingsLike,
} from './rules'

export type SessionContext = {
  actor: Actor
  user: User
  restrictions: RestrictionLike[]
  now: Date
}

/**
 * Resolves the caller for the current request.
 *
 * Supabase Auth proves *who* is asking (a cryptographically verified access
 * token); everything that governs *what they may do* - role, guild, ban state -
 * is read from the live `users` row every time. That split is what makes a ban
 * or a demotion take effect on the next request instead of at token expiry.
 * `cache` dedupes the lookup within one request.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const token = await readAccessToken()
  if (!token) return null

  const claims = await verifyAccessToken(token)
  if (!claims) return null

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseUserId, claims.sub))
    .limit(1)
  if (!user) return null

  const now = new Date()
  const restrictions = await loadRestrictions(user.id)

  // A token minted before the account was banned or deactivated is refused
  // here, not merely hidden in the UI.
  const access = evaluateAccountAccess(user, restrictions, now)
  if (!access.ok) return null

  return {
    user,
    restrictions,
    now,
    actor: {
      id: user.id,
      guildId: user.guildId,
      role: user.role,
      status: user.status,
      isActive: user.isActive,
    },
  }
})

export async function requireSession(): Promise<SessionContext> {
  const context = await getSessionContext()
  if (!context) throw new AppError('UNAUTHENTICATED', 'You must sign in to do that', 401)
  return context
}

export async function requireAdmin(): Promise<SessionContext> {
  const context = await requireSession()
  if (!isGuildAdmin(context.actor.role)) {
    throw failureToError({ ok: false, code: 'FORBIDDEN', message: 'Admin role required' })
  }
  return context
}

/** Guild tuning knobs, falling back to the schema defaults when unset. */
export async function getSettings(guildId: string): Promise<SettingsLike> {
  const [row] = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .limit(1)

  return {
    minParticipants: row?.minParticipants ?? 3,
    confirmationWindowHours: row?.confirmationWindowHours ?? 48,
    defaultCodeTtlMinutes: row?.defaultCodeTtlMinutes ?? 60,
    maxCodeTtlMinutes: row?.maxCodeTtlMinutes ?? 720,
    maxRegistrationsPerDay: row?.maxRegistrationsPerDay ?? 12,
    minLevelToRegister: row?.minLevelToRegister ?? 1,
    altPointsPolicy: row?.altPointsPolicy ?? 'CREDIT_MAIN',
    adminGrantApprovalThreshold: row?.adminGrantApprovalThreshold ?? 500,
    auctionAntiSnipeSeconds: row?.auctionAntiSnipeSeconds ?? 120,
  }
}

/** Hashed request fingerprint used to correlate suspicious registrations. */
export async function getRequestFingerprint(): Promise<{
  ipHash: string | null
  userAgentHash: string | null
}> {
  const headerList = await headers()
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    null
  return {
    ipHash: fingerprint(ip),
    userAgentHash: fingerprint(headerList.get('user-agent')),
  }
}
