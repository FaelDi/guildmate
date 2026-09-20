import 'server-only'

import { cache } from 'react'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { guildSettings, guilds, type Guild } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import { evaluateGuildCreate, type Actor } from '@/lib/rules'
import { issueMemberInvite } from './member-invites'

/**
 * This deployment belongs to one guild: the **primary** guild, whose name is
 * the name of the site and whose board is what a visitor sees before signing
 * in. Other guilds can still exist - the schema is multi-tenant and the super
 * admin can create more - they are simply not the front page.
 *
 * Which one is primary comes from `PRIMARY_GUILD_SLUG`, falling back to the
 * oldest guild, so a fresh install works with no configuration.
 */
export const getPrimaryGuild = cache(async (): Promise<Guild | null> => {
  const slug = process.env.PRIMARY_GUILD_SLUG?.trim().toLowerCase()

  if (slug) {
    const [named] = await db.select().from(guilds).where(eq(guilds.slug, slug)).limit(1)
    if (named) return named
    // A misconfigured slug must not take the site down; fall through to the
    // oldest guild and say so in the log.
    console.warn(`[guilds] PRIMARY_GUILD_SLUG="${slug}" matches no guild, using the oldest one`)
  }

  const [oldest] = await db.select().from(guilds).orderBy(asc(guilds.createdAt)).limit(1)
  return oldest ?? null
})

export async function requirePrimaryGuild(): Promise<Guild> {
  const guild = await getPrimaryGuild()
  if (!guild) throw new AppError('GUILD_NOT_FOUND', 'No guild exists on this deployment', 404)
  return guild
}

/** A month is plenty for whoever is taking over a brand-new guild. */
const LEADER_LINK_TTL_HOURS = 720

/**
 * Creates another guild and, with it, the single-use link that makes whoever
 * redeems it its LEADER. Super admin only (`evaluateGuildCreate`).
 *
 * The creator stays in their own guild: an account belongs to exactly one, so
 * handing over a link is what lets a second guild exist without anybody having
 * to abandon the first.
 */
export async function createGuild(params: {
  actor: Actor
  name: string
  tag: string | null
  note: string | null
  now: Date
}): Promise<{ guildId: string; slug: string; token: string; expiresAt: Date }> {
  const { actor, now } = params
  const draft = unwrap(evaluateGuildCreate({ actor, name: params.name, tag: params.tag }))

  const guildId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: guilds.id })
      .from(guilds)
      .where(eq(guilds.slug, draft.slug))
      .limit(1)
    if (existing) throw new AppError('GUILD_EXISTS', 'A guild with that name already exists', 409)

    const [guild] = await tx
      .insert(guilds)
      .values({ name: draft.name, slug: draft.slug, tag: draft.tag })
      .returning({ id: guilds.id })
    if (!guild) throw new AppError('INTERNAL_ERROR', 'Failed to create the guild', 500)

    // Every threshold the rules read has a row from the first minute, so the
    // new guild behaves like the primary one without anybody configuring it.
    await tx.insert(guildSettings).values({ guildId: guild.id })

    await recordAudit(
      {
        guildId: guild.id,
        actorUserId: actor.id,
        action: 'guild.create',
        entityType: 'guild',
        entityId: guild.id,
        after: { name: draft.name, slug: draft.slug, tag: draft.tag },
      },
      tx,
    )

    return guild.id
  })

  const invite = await issueMemberInvite({
    actor,
    guildId,
    input: {
      note: params.note ?? `Leader link for ${draft.name}`,
      maxUses: 1,
      ttlHours: LEADER_LINK_TTL_HOURS,
      grantsRole: 'LEADER',
    },
    now,
  })

  return { guildId, slug: draft.slug, token: invite.token, expiresAt: invite.expiresAt }
}

/** Every guild on the deployment, for the super admin's panel. */
export async function listGuilds(limit = 100) {
  return db.select().from(guilds).orderBy(asc(guilds.createdAt)).limit(limit)
}
