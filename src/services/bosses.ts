import 'server-only'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { bossGroups, bosses } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeAdminAction,
  nextSpawn,
  resolveBossSchedule,
  validateBossSchedule,
  type Actor,
  type BossSchedule,
} from '@/lib/rules'

/**
 * The boss schedule. Guild-wide reference data: everybody reads it, only
 * admins write it, and nothing here touches points.
 */

const MAX_BOSSES = 300
const MAX_GROUPS = 50

export const scheduleSchema = z.object({
  respawnKind: z.enum(['INTERVAL', 'DAILY', 'WEEKLY']),
  intervalHours: z.number().int().nullable(),
  anchorAt: z.date().nullable(),
  dailyTimes: z.string().max(200).nullable(),
  weekdays: z.string().max(20).nullable(),
})

const nameSchema = z.string().trim().min(2).max(120)

function assertUuid(value: string): string {
  if (!z.string().uuid().safeParse(value).success) throw new AppError('NOT_FOUND', 'Not found', 404)
  return value
}

function parseName(value: string, code: string, message: string): string {
  const parsed = nameSchema.safeParse(value)
  if (!parsed.success) throw new AppError(code, message)
  return parsed.data
}

export async function saveBossGroup(params: {
  actor: Actor
  id: string | null
  name: string
  schedule: BossSchedule
}): Promise<{ id: string }> {
  const { actor } = params
  unwrap(authorizeAdminAction(actor, actor.guildId))
  const name = parseName(params.name, 'INVALID_LABEL', 'The group name must be between 2 and 120 characters')
  const schedule = unwrap(validateBossSchedule(scheduleSchema.parse(params.schedule)))

  return db.transaction(async (tx) => {
    let id: string
    if (params.id) {
      const [existing] = await tx
        .select({ id: bossGroups.id, guildId: bossGroups.guildId })
        .from(bossGroups)
        .where(eq(bossGroups.id, assertUuid(params.id)))
        .limit(1)
      if (!existing || existing.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
      await tx.update(bossGroups).set({ name, ...schedule }).where(eq(bossGroups.id, existing.id))
      id = existing.id
    } else {
      const [created] = await tx
        .insert(bossGroups)
        .values({ guildId: actor.guildId, name, ...schedule })
        .returning({ id: bossGroups.id })
      if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to save the group', 500)
      id = created.id
    }

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: params.id ? 'boss_group.update' : 'boss_group.create',
        entityType: 'boss_group',
        entityId: id,
        after: { name, ...schedule },
      },
      tx,
    )
    return { id }
  })
}

export async function deleteBossGroup(params: { actor: Actor; id: string }): Promise<void> {
  const { actor } = params
  unwrap(authorizeAdminAction(actor, actor.guildId))
  const id = assertUuid(params.id)

  await db.transaction(async (tx) => {
    const [group] = await tx.select().from(bossGroups).where(eq(bossGroups.id, id)).limit(1)
    if (!group || group.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
    // Bosses in the group keep existing; the FK sets their group to NULL.
    await tx.delete(bossGroups).where(eq(bossGroups.id, id))
    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'boss_group.delete',
        entityType: 'boss_group',
        entityId: id,
        before: { name: group.name },
      },
      tx,
    )
  })
}

export async function saveBoss(params: {
  actor: Actor
  id: string | null
  name: string
  location: string
  groupId: string | null
  /** Used only when the boss has no group. */
  schedule: BossSchedule | null
}): Promise<{ id: string }> {
  const { actor } = params
  unwrap(authorizeAdminAction(actor, actor.guildId))
  const name = parseName(params.name, 'INVALID_LABEL', 'The boss name must be between 2 and 120 characters')
  const location = parseName(params.location, 'INVALID_LOCATION', 'The location must be between 2 and 120 characters')

  const own =
    params.groupId === null
      ? params.schedule === null
        ? (() => {
            throw new AppError('INVALID_SCHEDULE', 'A boss without a group needs its own schedule')
          })()
        : unwrap(validateBossSchedule(scheduleSchema.parse(params.schedule)))
      : null

  return db.transaction(async (tx) => {
    if (params.groupId !== null) {
      const [group] = await tx
        .select({ guildId: bossGroups.guildId })
        .from(bossGroups)
        .where(eq(bossGroups.id, assertUuid(params.groupId)))
        .limit(1)
      if (!group || group.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
    }

    const values = {
      name,
      location,
      groupId: params.groupId,
      respawnKind: own?.respawnKind ?? null,
      intervalHours: own?.intervalHours ?? null,
      anchorAt: own?.anchorAt ?? null,
      dailyTimes: own?.dailyTimes ?? null,
      weekdays: own?.weekdays ?? null,
    }

    let id: string
    if (params.id) {
      const [existing] = await tx
        .select({ id: bosses.id, guildId: bosses.guildId })
        .from(bosses)
        .where(eq(bosses.id, assertUuid(params.id)))
        .limit(1)
      if (!existing || existing.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
      await tx.update(bosses).set(values).where(eq(bosses.id, existing.id))
      id = existing.id
    } else {
      const [created] = await tx
        .insert(bosses)
        .values({ guildId: actor.guildId, ...values })
        .returning({ id: bosses.id })
      if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to save the boss', 500)
      id = created.id
    }

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: params.id ? 'boss.update' : 'boss.create',
        entityType: 'boss',
        entityId: id,
        after: values,
      },
      tx,
    )
    return { id }
  })
}

export async function deleteBoss(params: { actor: Actor; id: string }): Promise<void> {
  const { actor } = params
  unwrap(authorizeAdminAction(actor, actor.guildId))
  const id = assertUuid(params.id)

  await db.transaction(async (tx) => {
    const [boss] = await tx.select().from(bosses).where(eq(bosses.id, id)).limit(1)
    if (!boss || boss.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
    await tx.delete(bosses).where(eq(bosses.id, id))
    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'boss.delete',
        entityType: 'boss',
        entityId: id,
        before: { name: boss.name },
      },
      tx,
    )
  })
}

/** Replaces this week's rotation with exactly the bosses ticked. */
export async function setRotation(params: { actor: Actor; bossIds: string[] }): Promise<void> {
  const { actor } = params
  unwrap(authorizeAdminAction(actor, actor.guildId))
  const ids = z.array(z.string().uuid()).max(MAX_BOSSES).parse([...new Set(params.bossIds)])

  await db.transaction(async (tx) => {
    await tx.update(bosses).set({ inRotation: false }).where(eq(bosses.guildId, actor.guildId))
    if (ids.length > 0) {
      await tx
        .update(bosses)
        .set({ inRotation: true })
        .where(and(eq(bosses.guildId, actor.guildId), inArray(bosses.id, ids)))
    }
    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'boss.rotation',
        entityType: 'guild',
        entityId: actor.guildId,
        after: { bosses: ids.length },
      },
      tx,
    )
  })
}

export type BossView = {
  id: string
  name: string
  location: string
  groupId: string | null
  groupName: string | null
  inRotation: boolean
  /** Epoch ms of the next spawn at render time; the client counts down from it. */
  nextSpawnMs: number | null
  schedule: BossSchedule | null
}

export async function listBossBoard(guildId: string, now: Date) {
  const [groups, rows] = await Promise.all([
    db
      .select()
      .from(bossGroups)
      .where(eq(bossGroups.guildId, guildId))
      .orderBy(asc(bossGroups.name))
      .limit(MAX_GROUPS),
    db
      .select()
      .from(bosses)
      .where(eq(bosses.guildId, guildId))
      .orderBy(asc(bosses.name))
      .limit(MAX_BOSSES),
  ])

  const groupById = new Map(groups.map((g) => [g.id, g]))
  const list: BossView[] = rows.map((boss) => {
    const group = boss.groupId ? (groupById.get(boss.groupId) ?? null) : null
    const schedule = resolveBossSchedule(boss, group)
    const next = schedule ? nextSpawn(schedule, now) : null
    return {
      id: boss.id,
      name: boss.name,
      location: boss.location,
      groupId: boss.groupId,
      groupName: group?.name ?? null,
      inRotation: boss.inRotation,
      nextSpawnMs: next?.getTime() ?? null,
      schedule,
    }
  })

  return { groups, bosses: list }
}
