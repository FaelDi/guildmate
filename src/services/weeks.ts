import 'server-only'

import { and, desc, eq, gte, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Executor } from '@/db'
import {
  attendanceExcuses,
  eventRegistrations,
  events,
  guildSettings,
  guildWeeks,
  users,
} from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import {
  computeParticipation,
  evaluateExcuse,
  evaluateThresholdUpdate,
  evaluateWeekAdvance,
  type Actor,
} from '@/lib/rules'

/**
 * The weekly cycle: which week it is, how much of it each member showed up
 * for, and the admin controls that move it (next week, excused absences, the
 * Mega/Titan thresholds).
 */

export type CurrentWeek = {
  /** Null until an admin opens the first week; reads fall back to "since ever". */
  id: string | null
  number: number
  startedAt: Date
}

const uuidSchema = z.string().uuid()

function assertUuid(value: string): string {
  if (!uuidSchema.safeParse(value).success) {
    throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
  }
  return value
}

export async function getCurrentWeek(guildId: string, executor: Executor = db): Promise<CurrentWeek> {
  const [row] = await executor
    .select({ id: guildWeeks.id, number: guildWeeks.number, startedAt: guildWeeks.startedAt })
    .from(guildWeeks)
    .where(eq(guildWeeks.guildId, guildId))
    .orderBy(desc(guildWeeks.number))
    .limit(1)

  return row ?? { id: null, number: 1, startedAt: new Date(0) }
}

/**
 * Participation for every member of the guild in one pass: three grouped
 * aggregates, never the rows themselves.
 */
export async function getGuildParticipation(
  guildId: string,
  week: CurrentWeek,
  executor: Executor = db,
): Promise<Map<string, number>> {
  const weekEvents = and(
    eq(events.guildId, guildId),
    gte(events.startsAt, week.startedAt),
    ne(events.status, 'CANCELLED'),
  )

  const [heldRows, createdRows, attendedRows, excusedRows, memberRows] = await Promise.all([
    executor.select({ total: sql<number>`count(*)::int` }).from(events).where(weekEvents),
    executor
      .select({ userId: events.createdByUserId, total: sql<number>`count(*)::int` })
      .from(events)
      .where(weekEvents)
      .groupBy(events.createdByUserId),
    executor
      .select({
        userId: eventRegistrations.userId,
        total: sql<number>`count(distinct ${eventRegistrations.eventId})::int`,
      })
      .from(eventRegistrations)
      .innerJoin(events, eq(events.id, eventRegistrations.eventId))
      .where(and(weekEvents, ne(eventRegistrations.status, 'REVERSED')))
      .groupBy(eventRegistrations.userId),
    week.id === null
      ? Promise.resolve([] as { userId: string; total: number }[])
      : executor
          .select({
            userId: attendanceExcuses.userId,
            total: sql<number>`coalesce(sum(${attendanceExcuses.eventsExcused}), 0)::int`,
          })
          .from(attendanceExcuses)
          .where(and(eq(attendanceExcuses.weekId, week.id), isNull(attendanceExcuses.revokedAt)))
          .groupBy(attendanceExcuses.userId),
    executor.select({ id: users.id }).from(users).where(eq(users.guildId, guildId)).limit(1000),
  ])

  const held = Number(heldRows[0]?.total ?? 0)
  const created = new Map(createdRows.map((r) => [r.userId, Number(r.total)]))
  const attended = new Map(attendedRows.map((r) => [r.userId, Number(r.total)]))
  const excused = new Map(excusedRows.map((r) => [r.userId, Number(r.total)]))

  const result = new Map<string, number>()
  for (const member of memberRows) {
    result.set(
      member.id,
      computeParticipation({
        eventsHeld: held - (created.get(member.id) ?? 0),
        eventsAttended: attended.get(member.id) ?? 0,
        eventsExcused: excused.get(member.id) ?? 0,
      }),
    )
  }
  return result
}

/** One member's participation, for the bet check inside its transaction. */
export async function getMemberParticipation(
  params: { guildId: string; userId: string },
  executor: Executor,
): Promise<number> {
  const week = await getCurrentWeek(params.guildId, executor)
  const weekEvents = and(
    eq(events.guildId, params.guildId),
    gte(events.startsAt, week.startedAt),
    ne(events.status, 'CANCELLED'),
  )

  const [[held], [created], [attended], excused] = await Promise.all([
    executor.select({ total: sql<number>`count(*)::int` }).from(events).where(weekEvents),
    executor
      .select({ total: sql<number>`count(*)::int` })
      .from(events)
      .where(and(weekEvents, eq(events.createdByUserId, params.userId))),
    executor
      .select({ total: sql<number>`count(distinct ${eventRegistrations.eventId})::int` })
      .from(eventRegistrations)
      .innerJoin(events, eq(events.id, eventRegistrations.eventId))
      .where(
        and(
          weekEvents,
          eq(eventRegistrations.userId, params.userId),
          ne(eventRegistrations.status, 'REVERSED'),
        ),
      ),
    week.id === null
      ? Promise.resolve([{ total: 0 }])
      : executor
          .select({
            total: sql<number>`coalesce(sum(${attendanceExcuses.eventsExcused}), 0)::int`,
          })
          .from(attendanceExcuses)
          .where(
            and(
              eq(attendanceExcuses.weekId, week.id),
              eq(attendanceExcuses.userId, params.userId),
              isNull(attendanceExcuses.revokedAt),
            ),
          ),
  ])

  return computeParticipation({
    eventsHeld: Number(held?.total ?? 0) - Number(created?.total ?? 0),
    eventsAttended: Number(attended?.total ?? 0),
    eventsExcused: Number(excused[0]?.total ?? 0),
  })
}

/**
 * Opens the next week. The guild row is locked so two admins pressing the
 * button at once produce one week, not two.
 */
export async function advanceWeek(params: { actor: Actor; now: Date }): Promise<{ number: number }> {
  const { actor, now } = params

  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from guilds where id = ${actor.guildId} for update`)
    const current = await getCurrentWeek(actor.guildId, tx)

    const plan = unwrap(
      evaluateWeekAdvance({
        actor,
        guildId: actor.guildId,
        currentWeek: current.id === null ? null : current,
        now,
      }),
    )

    await tx.insert(guildWeeks).values({
      guildId: actor.guildId,
      number: plan.number,
      startedAt: now,
      startedByUserId: actor.id,
    })

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'week.advance',
        entityType: 'guild',
        entityId: actor.guildId,
        before: { number: current.id === null ? null : current.number },
        after: { number: plan.number },
      },
      tx,
    )

    return plan
  })
}

/** The week excuses attach to. Creates week 1 the first time it is needed. */
async function ensureCurrentWeekId(guildId: string, actorId: string, now: Date, tx: Executor) {
  const current = await getCurrentWeek(guildId, tx)
  if (current.id !== null) return current.id

  const [created] = await tx
    .insert(guildWeeks)
    .values({ guildId, number: 1, startedAt: now, startedByUserId: actorId })
    .onConflictDoNothing()
    .returning({ id: guildWeeks.id })
  if (created) return created.id

  const again = await getCurrentWeek(guildId, tx)
  if (again.id === null) throw new AppError('INTERNAL_ERROR', 'Failed to open the week', 500)
  return again.id
}

export async function excuseAbsence(params: {
  actor: Actor
  userId: string
  eventsExcused: number
  reason: string
  now: Date
}): Promise<void> {
  const { actor, now } = params
  const userId = assertUuid(params.userId)

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, guildId: users.guildId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!target) throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)

    const plan = unwrap(
      evaluateExcuse({
        actor,
        target,
        eventsExcused: params.eventsExcused,
        reason: params.reason,
      }),
    )

    const weekId = await ensureCurrentWeekId(actor.guildId, actor.id, now, tx)
    const [row] = await tx
      .insert(attendanceExcuses)
      .values({
        guildId: actor.guildId,
        weekId,
        userId,
        eventsExcused: plan.eventsExcused,
        reason: plan.reason,
        createdByUserId: actor.id,
      })
      .returning({ id: attendanceExcuses.id })

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'attendance.excuse',
        entityType: 'attendance_excuse',
        entityId: row?.id ?? null,
        after: { userId, eventsExcused: plan.eventsExcused, reason: plan.reason },
      },
      tx,
    )
  })
}

/** Logical removal, so the trail of who excused whom survives. */
export async function revokeExcuse(params: {
  actor: Actor
  excuseId: string
  now: Date
}): Promise<void> {
  const { actor, now } = params
  const excuseId = assertUuid(params.excuseId)

  await db.transaction(async (tx) => {
    const [excuse] = await tx
      .select()
      .from(attendanceExcuses)
      .where(eq(attendanceExcuses.id, excuseId))
      .limit(1)
      .for('update')
    if (!excuse || excuse.guildId !== actor.guildId) {
      throw new AppError('NOT_FOUND', 'Excuse not found', 404)
    }
    // Revoking lowers the target's participation, so it is held to the same
    // gate as granting: an admin, never on their own account.
    unwrap(
      evaluateExcuse({
        actor,
        target: { id: excuse.userId, guildId: excuse.guildId },
        eventsExcused: excuse.eventsExcused,
        reason: excuse.reason,
      }),
    )
    if (excuse.revokedAt !== null) return

    await tx
      .update(attendanceExcuses)
      .set({ revokedAt: now, revokedByUserId: actor.id })
      .where(eq(attendanceExcuses.id, excuseId))

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'attendance.excuse_revoke',
        entityType: 'attendance_excuse',
        entityId: excuseId,
        before: { eventsExcused: excuse.eventsExcused },
      },
      tx,
    )
  })
}

/** This week's live excuses, for the admin panel. */
export async function listWeekExcuses(guildId: string, limit = 200) {
  const week = await getCurrentWeek(guildId)
  if (week.id === null) return []
  return db
    .select({
      id: attendanceExcuses.id,
      userId: attendanceExcuses.userId,
      eventsExcused: attendanceExcuses.eventsExcused,
      reason: attendanceExcuses.reason,
      createdAt: attendanceExcuses.createdAt,
    })
    .from(attendanceExcuses)
    .where(and(eq(attendanceExcuses.weekId, week.id), isNull(attendanceExcuses.revokedAt)))
    .orderBy(desc(attendanceExcuses.createdAt))
    .limit(limit)
}

export async function updateThresholds(params: {
  actor: Actor
  megaCpThreshold: number
  titanCpThreshold: number
}): Promise<void> {
  const { actor } = params
  const plan = unwrap(
    evaluateThresholdUpdate({
      actor,
      guildId: actor.guildId,
      megaCpThreshold: params.megaCpThreshold,
      titanCpThreshold: params.titanCpThreshold,
    }),
  )

  await db.transaction(async (tx) => {
    await tx
      .insert(guildSettings)
      .values({ guildId: actor.guildId, ...plan })
      .onConflictDoUpdate({
        target: guildSettings.guildId,
        set: { ...plan, updatedAt: new Date() },
      })

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'settings.cp_thresholds',
        entityType: 'guild',
        entityId: actor.guildId,
        after: plan,
      },
      tx,
    )
  })
}
