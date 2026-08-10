import { and, count, desc, eq, gt, gte, inArray, ne, sql } from 'drizzle-orm'
import { db, type Executor } from '@/db'
import {
  characters,
  eventRegistrations,
  events,
  users,
  type GuildEvent,
} from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import {
  eventCodeLookup,
  generateEventCode,
  hashEventCode,
  normalizeEventCode,
  verifyEventCode,
} from '@/lib/crypto'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeAdminAction,
  authorizeResource,
  evaluateAdminGrant,
  evaluateRegistration,
  planPointsChange,
  resolveCodeExpiry,
  resolveEventQuorum,
  resolveConfirmationDeadline,
  resolveEventSweep,
  type Actor,
  type CharacterLike,
  type EventLike,
  type SettingsLike,
} from '@/lib/rules'
import { loadRestrictions } from '@/lib/restrictions'
import { appendLedger, confirmEventLedger, reverseEventLedger } from './points'

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function toEventLike(event: GuildEvent): EventLike {
  return {
    id: event.id,
    guildId: event.guildId,
    status: event.status,
    pointsValue: event.pointsValue,
    startsAt: event.startsAt,
    registrationClosesAt: event.registrationClosesAt,
    confirmationDeadline: event.confirmationDeadline,
    minParticipants: event.minParticipants,
    createdByUserId: event.createdByUserId,
  }
}

async function loadEvent(eventId: string, executor: Executor = db): Promise<GuildEvent> {
  const [event] = await executor.select().from(events).where(eq(events.id, eventId)).limit(1)
  if (!event) throw new AppError('NOT_FOUND', 'Event not found', 404)
  return event
}

async function loadCharacter(characterId: string, executor: Executor = db): Promise<CharacterLike> {
  const [character] = await executor
    .select({
      id: characters.id,
      userId: characters.userId,
      guildId: characters.guildId,
      kind: characters.kind,
      mainCharacterId: characters.mainCharacterId,
      level: characters.level,
      isActive: characters.isActive,
    })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1)

  // Same 403 an outsider would get: never confirm that an id exists.
  if (!character) throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
  return character
}

/** Registrations that still count towards quorum (reversed ones do not). */
async function countRegistrations(eventId: string, executor: Executor): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(eventRegistrations)
    .where(and(eq(eventRegistrations.eventId, eventId), ne(eventRegistrations.status, 'REVERSED')))
  return Number(row?.value ?? 0)
}

// ---------------------------------------------------------------------------
// Creation & administration
// ---------------------------------------------------------------------------

export type CreateEventInput = {
  name: string
  description?: string | null
  pointsValue: number
  /** Join-code lifetime in minutes, capped by the guild settings. */
  ttlMinutes: number
  minParticipants?: number
}

/**
 * Creates an event and returns the join code ONCE. Only the digest and a blind
 * index are persisted, so the plaintext can never be read back from the
 * database - an admin who loses it rotates the code instead.
 */
export async function createEvent(params: {
  actor: Actor
  settings: SettingsLike
  input: CreateEventInput
  now: Date
}): Promise<{ event: GuildEvent; code: string }> {
  const { actor, settings, input, now } = params
  unwrap(authorizeAdminAction(actor, actor.guildId))

  const name = input.name.trim()
  if (name.length < 3 || name.length > 120) {
    throw new AppError('INVALID_NAME', 'The event name must be between 3 and 120 characters')
  }
  if (!Number.isInteger(input.pointsValue) || input.pointsValue < 1 || input.pointsValue > 100_000) {
    throw new AppError('INVALID_POINTS', 'Points must be a whole number between 1 and 100000')
  }
  const minParticipants = unwrap(
    resolveEventQuorum({ requested: input.minParticipants, settings }),
  )

  const registrationClosesAt = unwrap(
    resolveCodeExpiry({ ttlMinutes: input.ttlMinutes, settings, now }),
  )
  const code = generateEventCode()

  const created = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({
        guildId: actor.guildId,
        name,
        description: input.description?.trim() || null,
        pointsValue: input.pointsValue,
        status: 'OPEN',
        codeHash: await hashEventCode(code),
        codeLookup: eventCodeLookup(code),
        codeHint: normalizeEventCode(code).slice(-2),
        startsAt: now,
        registrationClosesAt,
        confirmationDeadline: resolveConfirmationDeadline(settings, now),
        minParticipants,
        createdByUserId: actor.id,
      })
      .returning()

    if (!event) throw new AppError('INTERNAL_ERROR', 'Failed to create the event', 500)

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'event.create',
        entityType: 'event',
        entityId: event.id,
        after: {
          name: event.name,
          pointsValue: event.pointsValue,
          minParticipants: event.minParticipants,
          registrationClosesAt: event.registrationClosesAt,
        },
      },
      tx,
    )

    return event
  })

  return { event: created, code }
}

/** Issues a fresh code, invalidating the previous one immediately. */
export async function rotateEventCode(params: {
  actor: Actor
  eventId: string
  now: Date
}): Promise<{ code: string }> {
  const { actor, eventId, now } = params
  const event = await loadEvent(eventId)

  // The creator, or any admin of the same guild.
  unwrap(
    authorizeResource({
      actor,
      ownerUserId: event.createdByUserId,
      resourceGuildId: event.guildId,
    }),
  )
  unwrap(authorizeAdminAction(actor, event.guildId))
  if (event.status !== 'OPEN') {
    throw new AppError('EVENT_CLOSED', 'Only an open event can have its code rotated')
  }

  const code = generateEventCode()
  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({
        codeHash: await hashEventCode(code),
        codeLookup: eventCodeLookup(code),
        codeHint: normalizeEventCode(code).slice(-2),
        codeRotatedAt: now,
        updatedAt: now,
      })
      .where(eq(events.id, eventId))

    await recordAudit(
      {
        guildId: event.guildId,
        actorUserId: actor.id,
        action: 'event.rotate_code',
        entityType: 'event',
        entityId: eventId,
      },
      tx,
    )
  })

  return { code }
}

/**
 * Re-scores an event that already has registrations.
 *
 * Every existing registration receives a delta entry, so changing an event from
 * 100 to 150 points immediately updates everyone who registered - without ever
 * editing a historical ledger row.
 */
export async function changeEventPoints(params: {
  actor: Actor
  eventId: string
  newPoints: number
  reason: string
  now: Date
}): Promise<{ delta: number; affected: number }> {
  const { actor, eventId, newPoints, reason, now } = params

  if (!Number.isInteger(newPoints) || newPoints < 1 || newPoints > 100_000) {
    throw new AppError('INVALID_POINTS', 'Points must be a whole number between 1 and 100000')
  }
  if (reason.trim().length < 3) {
    throw new AppError('REASON_REQUIRED', 'A reason is required when re-scoring an event')
  }

  return db.transaction(async (tx) => {
    const event = await loadEvent(eventId, tx)
    unwrap(authorizeAdminAction(actor, event.guildId))
    if (event.status === 'CANCELLED') {
      throw new AppError('EVENT_CANCELLED', 'A cancelled event cannot be re-scored')
    }
    if (event.pointsValue === newPoints) return { delta: 0, affected: 0 }

    const registrations = await tx
      .select({
        id: eventRegistrations.id,
        userId: eventRegistrations.userId,
        characterId: eventRegistrations.characterId,
        status: eventRegistrations.status,
      })
      .from(eventRegistrations)
      .where(eq(eventRegistrations.eventId, eventId))

    const plan = planPointsChange({
      oldPoints: event.pointsValue,
      newPoints,
      registrations,
    })

    await tx
      .update(events)
      .set({ pointsValue: newPoints, updatedAt: now })
      .where(eq(events.id, eventId))

    for (const adjustment of plan.adjustments) {
      await appendLedger(
        {
          guildId: event.guildId,
          userId: adjustment.userId,
          characterId: adjustment.characterId,
          kind: 'EVENT_ADJUSTMENT',
          state: adjustment.state,
          amount: adjustment.amount,
          reason: `Event re-scored: ${reason.trim()}`,
          refType: 'event_registration',
          refId: adjustment.registrationId,
          eventId,
          createdByUserId: actor.id,
        },
        tx,
      )
    }

    await recordAudit(
      {
        guildId: event.guildId,
        actorUserId: actor.id,
        action: 'event.change_points',
        entityType: 'event',
        entityId: eventId,
        before: { pointsValue: event.pointsValue },
        after: { pointsValue: newPoints, delta: plan.delta, affected: plan.adjustments.length, reason },
      },
      tx,
    )

    return { delta: plan.delta, affected: plan.adjustments.length }
  })
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Rolling 24h count of self-service registrations, for the rate limit. */
async function countRecentRegistrations(
  userId: string,
  now: Date,
  executor: Executor,
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.userId, userId),
        eq(eventRegistrations.source, 'SELF_CODE'),
        gte(eventRegistrations.registeredAt, new Date(now.getTime() - 24 * 3_600_000)),
      ),
    )
  return Number(row?.value ?? 0)
}

/**
 * Confirms an event if quorum has been reached, promoting every pending award
 * to spendable. Idempotent: re-running it on a confirmed event is a no-op.
 */
async function confirmEventIfQuorum(
  event: GuildEvent,
  now: Date,
  tx: Executor,
): Promise<boolean> {
  const registrationCount = await countRegistrations(event.id, tx)
  if (registrationCount < event.minParticipants) return false
  if (event.status === 'CONFIRMED' || event.status === 'CANCELLED') return false

  await tx
    .update(events)
    .set({ status: 'CONFIRMED', confirmedAt: now, updatedAt: now })
    .where(and(eq(events.id, event.id), ne(events.status, 'CANCELLED')))

  await tx
    .update(eventRegistrations)
    .set({ status: 'CONFIRMED' })
    .where(
      and(eq(eventRegistrations.eventId, event.id), eq(eventRegistrations.status, 'PENDING')),
    )

  await confirmEventLedger(event.id, tx)
  return true
}

export type RegistrationOutcome = {
  eventId: string
  eventName: string
  pointsAwarded: number
  /** Points are spendable only once the event reaches quorum. */
  confirmed: boolean
  registrationsSoFar: number
  minParticipants: number
}

/**
 * A player redeems an event code.
 *
 * All the anti-fraud preconditions live in `evaluateRegistration`; this
 * function is responsible for finding the event, holding the transaction and
 * writing the pending award.
 */
export async function registerWithCode(params: {
  actor: Actor
  characterId: string
  code: string
  settings: SettingsLike
  fingerprints: { ipHash: string | null; userAgentHash: string | null }
  now: Date
}): Promise<RegistrationOutcome> {
  const { actor, characterId, code, settings, fingerprints, now } = params

  const normalized = normalizeEventCode(code)
  if (normalized.length < 4 || normalized.length > 32) {
    throw new AppError('INVALID_CODE', 'That event code is not valid')
  }

  // One indexed lookup, then a real scrypt verification as defence in depth.
  const candidates = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.guildId, actor.guildId),
        eq(events.codeLookup, eventCodeLookup(normalized)),
        eq(events.status, 'OPEN'),
        gt(events.registrationClosesAt, now),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(5)

  let matched: GuildEvent | null = null
  for (const candidate of candidates) {
    if (await verifyEventCode(normalized, candidate.codeHash)) {
      matched = candidate
      break
    }
  }
  // A wrong code and an expired code are reported the same way, so the form
  // cannot be used to probe which codes exist.
  if (!matched) throw new AppError('INVALID_CODE', 'That event code is not valid or has expired')

  const eventId = matched.id

  return db.transaction(async (tx) => {
    const event = await loadEvent(eventId, tx)
    const character = await loadCharacter(characterId, tx)
    const restrictions = await loadRestrictions(actor.id, tx)

    const [existing] = await tx
      .select({ id: eventRegistrations.id })
      .from(eventRegistrations)
      .where(
        and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.userId, actor.id)),
      )
      .limit(1)

    const grant = unwrap(
      evaluateRegistration({
        event: toEventLike(event),
        character,
        actor,
        settings,
        restrictions,
        accountAlreadyRegistered: Boolean(existing),
        registrationsLast24h: await countRecentRegistrations(actor.id, now, tx),
        now,
      }),
    )

    const [registration] = await tx
      .insert(eventRegistrations)
      .values({
        eventId,
        userId: actor.id,
        characterId: character.id,
        status: 'PENDING',
        source: 'SELF_CODE',
        levelAtRegistration: character.level,
        ipHash: fingerprints.ipHash,
        userAgentHash: fingerprints.userAgentHash,
        registeredAt: now,
      })
      .returning({ id: eventRegistrations.id })

    if (!registration) throw new AppError('INTERNAL_ERROR', 'Failed to register', 500)

    await appendLedger(
      {
        guildId: event.guildId,
        userId: grant.creditUserId,
        characterId: grant.creditCharacterId,
        kind: 'EVENT_AWARD',
        state: 'PENDING',
        amount: grant.points,
        reason: `Registered for event "${event.name}"`,
        refType: 'event_registration',
        refId: registration.id,
        eventId,
      },
      tx,
    )

    const confirmed = await confirmEventIfQuorum(event, now, tx)
    const registrationsSoFar = await countRegistrations(eventId, tx)

    await recordAudit(
      {
        guildId: event.guildId,
        actorUserId: actor.id,
        action: 'event.register',
        entityType: 'event_registration',
        entityId: registration.id,
        after: { eventId, characterId: character.id, points: grant.points, source: 'SELF_CODE' },
        ipHash: fingerprints.ipHash,
      },
      tx,
    )

    return {
      eventId,
      eventName: event.name,
      pointsAwarded: grant.points,
      confirmed: confirmed || event.status === 'CONFIRMED',
      registrationsSoFar,
      minParticipants: event.minParticipants,
    }
  })
}

/**
 * An admin scores a member manually.
 *
 * Requires an existing event and refuses to credit the admin's own account -
 * including through one of their alts, since the check is on the owning user.
 */
export async function grantEventPoints(params: {
  actor: Actor
  eventId: string
  characterId: string
  reason: string
  settings: SettingsLike
  fingerprints: { ipHash: string | null; userAgentHash: string | null }
  now: Date
}): Promise<RegistrationOutcome & { needsSecondApproval: boolean }> {
  const { actor, eventId, characterId, reason, settings, fingerprints, now } = params

  if (reason.trim().length < 3) {
    throw new AppError('REASON_REQUIRED', 'A reason is required for a manual award')
  }

  return db.transaction(async (tx) => {
    const event = await loadEvent(eventId, tx)
    const targetCharacter = await loadCharacter(characterId, tx)

    const [targetAccount] = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetCharacter.userId))
      .limit(1)
    if (!targetAccount) {
      throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
    }

    const [existing] = await tx
      .select({ id: eventRegistrations.id })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.eventId, eventId),
          eq(eventRegistrations.userId, targetAccount.id),
        ),
      )
      .limit(1)

    const grant = unwrap(
      evaluateAdminGrant({
        actor,
        event: toEventLike(event),
        targetCharacter,
        targetAccount,
        targetRestrictions: await loadRestrictions(targetAccount.id, tx),
        accountAlreadyRegistered: Boolean(existing),
        settings,
        now,
      }),
    )

    const [registration] = await tx
      .insert(eventRegistrations)
      .values({
        eventId,
        userId: targetAccount.id,
        characterId: targetCharacter.id,
        status: event.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING',
        source: 'ADMIN_GRANT',
        grantedByUserId: actor.id,
        levelAtRegistration: targetCharacter.level,
        ipHash: fingerprints.ipHash,
        userAgentHash: fingerprints.userAgentHash,
        registeredAt: now,
      })
      .returning({ id: eventRegistrations.id })

    if (!registration) throw new AppError('INTERNAL_ERROR', 'Failed to grant points', 500)

    await appendLedger(
      {
        guildId: event.guildId,
        userId: grant.creditUserId,
        characterId: grant.creditCharacterId,
        kind: 'EVENT_AWARD',
        state: event.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING',
        amount: grant.points,
        reason: `Admin award for "${event.name}": ${reason.trim()}`,
        refType: 'event_registration',
        refId: registration.id,
        eventId,
        createdByUserId: actor.id,
      },
      tx,
    )

    const confirmed = await confirmEventIfQuorum(event, now, tx)

    await recordAudit(
      {
        guildId: event.guildId,
        actorUserId: actor.id,
        action: 'event.admin_grant',
        entityType: 'event_registration',
        entityId: registration.id,
        after: {
          eventId,
          targetUserId: targetAccount.id,
          characterId: targetCharacter.id,
          points: grant.points,
          reason,
          needsSecondApproval: grant.needsSecondApproval,
        },
        ipHash: fingerprints.ipHash,
      },
      tx,
    )

    return {
      eventId,
      eventName: event.name,
      pointsAwarded: grant.points,
      confirmed: confirmed || event.status === 'CONFIRMED',
      registrationsSoFar: await countRegistrations(eventId, tx),
      minParticipants: event.minParticipants,
      needsSecondApproval: grant.needsSecondApproval,
    }
  })
}

// ---------------------------------------------------------------------------
// Cancellation & the scheduled sweep
// ---------------------------------------------------------------------------

async function cancelEventInTx(params: {
  event: GuildEvent
  reason: string
  actorUserId: string | null
  now: Date
  tx: Executor
}): Promise<void> {
  const { event, reason, actorUserId, now, tx } = params

  await tx
    .update(events)
    .set({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledByUserId: actorUserId,
      cancelReason: reason,
      updatedAt: now,
    })
    .where(eq(events.id, event.id))

  await tx
    .update(eventRegistrations)
    .set({ status: 'REVERSED' })
    .where(
      and(
        eq(eventRegistrations.eventId, event.id),
        ne(eventRegistrations.status, 'REVERSED'),
      ),
    )

  // Every award for this event is voided, pending or confirmed.
  await reverseEventLedger(event.id, tx)

  await recordAudit(
    {
      guildId: event.guildId,
      actorUserId,
      action: 'event.cancel',
      entityType: 'event',
      entityId: event.id,
      before: { status: event.status },
      after: { status: 'CANCELLED', reason },
    },
    tx,
  )
}

/**
 * Manual cancellation by an admin.
 *
 * Cancelling an already CONFIRMED event claws back points that members may have
 * already committed to auction bids, which can push a balance negative. That is
 * deliberate - the balance stays honest and bidding is blocked until it
 * recovers - but it requires `force` so it cannot happen by accident.
 */
export async function cancelEvent(params: {
  actor: Actor
  eventId: string
  reason: string
  force?: boolean
  now: Date
}): Promise<void> {
  const { actor, eventId, reason, force = false, now } = params
  if (reason.trim().length < 3) {
    throw new AppError('REASON_REQUIRED', 'A reason is required to cancel an event')
  }

  await db.transaction(async (tx) => {
    const event = await loadEvent(eventId, tx)
    unwrap(authorizeAdminAction(actor, event.guildId))

    if (event.status === 'CANCELLED') return
    if (event.status === 'CONFIRMED' && !force) {
      throw new AppError(
        'CONFIRMATION_REQUIRED',
        'This event is already confirmed. Cancelling it will reverse points that members may have already spent.',
      )
    }

    await cancelEventInTx({ event, reason: reason.trim(), actorUserId: actor.id, now, tx })
  })
}

export type SweepReport = {
  scanned: number
  confirmed: string[]
  cancelled: string[]
  closed: string[]
}

/**
 * The scheduled reconciliation, run by the Vercel cron.
 *
 * This is where the CEO's rule lands: an event that has not gathered
 * `minParticipants` registrations by its 48h deadline is cancelled and every
 * point it handed out is reversed.
 */
export async function sweepEvents(now: Date): Promise<SweepReport> {
  const open = await db
    .select()
    .from(events)
    .where(inArray(events.status, ['OPEN', 'PENDING_CONFIRMATION']))
    .limit(500)

  const report: SweepReport = { scanned: open.length, confirmed: [], cancelled: [], closed: [] }

  for (const event of open) {
    const registrationCount = await countRegistrations(event.id, db)
    const action = resolveEventSweep({ event, registrationCount, now })
    if (action === 'NONE') continue

    await db.transaction(async (tx) => {
      // Re-read inside the transaction: a registration may have landed between
      // the scan and now, which would change the verdict.
      const fresh = await loadEvent(event.id, tx)
      const freshCount = await countRegistrations(fresh.id, tx)
      const freshAction = resolveEventSweep({ event: fresh, registrationCount: freshCount, now })

      if (freshAction === 'CONFIRM') {
        if (await confirmEventIfQuorum(fresh, now, tx)) report.confirmed.push(fresh.id)
      } else if (freshAction === 'CANCEL') {
        await cancelEventInTx({
          event: fresh,
          reason: `Automatically cancelled: only ${freshCount} of ${fresh.minParticipants} required registrations within the confirmation window`,
          actorUserId: null,
          now,
          tx,
        })
        report.cancelled.push(fresh.id)
      } else if (freshAction === 'CLOSE_REGISTRATION') {
        await tx
          .update(events)
          .set({ status: 'PENDING_CONFIRMATION', updatedAt: now })
          .where(and(eq(events.id, fresh.id), eq(events.status, 'OPEN')))
        report.closed.push(fresh.id)
      }
    })
  }

  return report
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/**
 * The event a member could still register for right now, if there is one.
 *
 * Feeds the floating widget, so it runs on every authenticated page: one
 * indexed read on `events_guild_status_idx`, and it never selects the code or
 * its digest - the widget's whole job is to say a code exists somewhere else.
 *
 * An account that already registered gets nothing back: the point is to catch
 * people who have not, not to nag the ones who did.
 */
export async function getLiveEventForMember(params: { actor: Actor; now: Date }) {
  const { actor, now } = params

  const [event] = await db
    .select({
      id: events.id,
      name: events.name,
      pointsValue: events.pointsValue,
      registrationClosesAt: events.registrationClosesAt,
      minParticipants: events.minParticipants,
      registrationCount: sql<number>`(
        select count(*)::int from ${eventRegistrations}
        where ${eventRegistrations.eventId} = ${events.id}
          and ${eventRegistrations.status} <> 'REVERSED'
      )`,
      alreadyRegistered: sql<boolean>`exists (
        select 1 from ${eventRegistrations}
        where ${eventRegistrations.eventId} = ${events.id}
          and ${eventRegistrations.userId} = ${actor.id}
          and ${eventRegistrations.status} <> 'REVERSED'
      )`,
    })
    .from(events)
    .where(
      and(
        eq(events.guildId, actor.guildId),
        eq(events.status, 'OPEN'),
        gt(events.registrationClosesAt, now),
      ),
    )
    // The one closing soonest: that is the one worth interrupting somebody for.
    .orderBy(events.registrationClosesAt)
    .limit(1)

  if (!event || event.alreadyRegistered) return null
  return event
}

export async function listGuildEvents(guildId: string, limit = 100) {
  return db
    .select({
      id: events.id,
      name: events.name,
      description: events.description,
      pointsValue: events.pointsValue,
      status: events.status,
      codeHint: events.codeHint,
      registrationClosesAt: events.registrationClosesAt,
      confirmationDeadline: events.confirmationDeadline,
      minParticipants: events.minParticipants,
      createdByUserId: events.createdByUserId,
      createdAt: events.createdAt,
      registrationCount: sql<number>`(
        select count(*)::int from ${eventRegistrations}
        where ${eventRegistrations.eventId} = ${events.id}
          and ${eventRegistrations.status} <> 'REVERSED'
      )`,
    })
    .from(events)
    .where(eq(events.guildId, guildId))
    .orderBy(desc(events.createdAt))
    .limit(limit)
}

/** The admin-facing registration log: who claimed what, when, and at which level. */
export async function listRegistrationLog(guildId: string, limit = 200) {
  return db
    .select({
      id: eventRegistrations.id,
      eventId: eventRegistrations.eventId,
      eventName: events.name,
      status: eventRegistrations.status,
      source: eventRegistrations.source,
      grantedByUserId: eventRegistrations.grantedByUserId,
      registeredAt: eventRegistrations.registeredAt,
      levelAtRegistration: eventRegistrations.levelAtRegistration,
      characterId: characters.id,
      characterName: characters.name,
      characterKind: characters.kind,
      userId: users.id,
      userEmail: users.email,
      ipHash: eventRegistrations.ipHash,
    })
    .from(eventRegistrations)
    .innerJoin(events, eq(events.id, eventRegistrations.eventId))
    .innerJoin(characters, eq(characters.id, eventRegistrations.characterId))
    .innerJoin(users, eq(users.id, eventRegistrations.userId))
    .where(eq(events.guildId, guildId))
    .orderBy(desc(eventRegistrations.registeredAt))
    .limit(limit)
}
