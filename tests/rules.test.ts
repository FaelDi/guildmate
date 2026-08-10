import { describe, expect, it } from 'vitest'
import {
  activeRestrictionTypes,
  applyAntiSnipe,
  authorizeInviteIssue,
  authorizeModeration,
  authorizeResource,
  authorizeRoleChange,
  computeBalance,
  describeInviteStatus,
  describeMemberInviteStatus,
  deriveUserStatus,
  evaluateInviteRedemption,
  evaluateJoin,
  evaluateMemberInviteIssue,
  resolveInviteExpiry,
  INVITE_TTL_HOURS,
  MEMBER_INVITE_MAX_TTL_HOURS,
  MEMBER_INVITE_MAX_USES,
  evaluateAccountAccess,
  evaluateAdminGrant,
  evaluateBid,
  evaluateCharacterCreate,
  evaluateCharacterRetire,
  evaluateCharacterUpdate,
  evaluateListingCreate,
  evaluateMainSwitch,
  evaluateRegistration,
  isGuildAdmin,
  isRestrictionInForce,
  minimumBid,
  planPointsChange,
  resolveCodeExpiry,
  resolveEventQuorum,
  resolveEventSweep,
  MAX_CHARACTERS_PER_ACCOUNT,
  type Actor,
  type AuctionLike,
  type CharacterDraft,
  type CharacterLike,
  type EventLike,
  type GuildJoinLike,
  type InviteLike,
  type MemberInviteLike,
  type RestrictionLike,
  type SettingsLike,
} from '@/lib/rules'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-09T12:00:00.000Z')
const GUILD = '11111111-1111-1111-1111-111111111111'

const settings: SettingsLike = {
  minParticipants: 3,
  confirmationWindowHours: 48,
  defaultCodeTtlMinutes: 30,
  maxCodeTtlMinutes: 720,
  maxRegistrationsPerDay: 12,
  minLevelToRegister: 10,
  altPointsPolicy: 'CREDIT_MAIN',
  adminGrantApprovalThreshold: 500,
  auctionAntiSnipeSeconds: 120,
}

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'user-1',
    guildId: GUILD,
    role: 'MEMBER',
    status: 'ACTIVE',
    isActive: true,
    ...overrides,
  }
}

function character(overrides: Partial<CharacterLike> = {}): CharacterLike {
  return {
    id: 'char-1',
    userId: 'user-1',
    guildId: GUILD,
    kind: 'MAIN',
    mainCharacterId: null,
    level: 50,
    isActive: true,
    ...overrides,
  }
}

function event(overrides: Partial<EventLike> = {}): EventLike {
  return {
    id: 'event-1',
    guildId: GUILD,
    status: 'OPEN',
    pointsValue: 100,
    startsAt: new Date(NOW.getTime() - 60_000),
    registrationClosesAt: new Date(NOW.getTime() + 30 * 60_000),
    confirmationDeadline: new Date(NOW.getTime() + 48 * 3_600_000),
    minParticipants: 3,
    createdByUserId: 'admin-1',
    ...overrides,
  }
}

function registrationParams(overrides: Record<string, unknown> = {}) {
  return {
    event: event(),
    character: character(),
    actor: actor(),
    settings,
    restrictions: [] as RestrictionLike[],
    accountAlreadyRegistered: false,
    registrationsLast24h: 0,
    now: NOW,
    ...overrides,
  } as Parameters<typeof evaluateRegistration>[0]
}

// ---------------------------------------------------------------------------

describe('computeBalance', () => {
  it('separates pending from spendable and ignores reversed entries', () => {
    const balance = computeBalance([
      { amount: 100, state: 'CONFIRMED' },
      { amount: 50, state: 'PENDING' },
      { amount: 999, state: 'REVERSED' },
      { amount: -30, state: 'CONFIRMED' },
    ])
    expect(balance).toEqual({ pending: 50, available: 70 })
  })

  it('is zero for an empty ledger', () => {
    expect(computeBalance([])).toEqual({ pending: 0, available: 0 })
  })
})

describe('resolveEventSweep', () => {
  const base = {
    status: 'OPEN' as const,
    registrationClosesAt: new Date(NOW.getTime() + 60_000),
    confirmationDeadline: new Date(NOW.getTime() + 3_600_000),
    minParticipants: 3,
  }

  it('confirms as soon as quorum is reached', () => {
    expect(resolveEventSweep({ event: base, registrationCount: 3, now: NOW })).toBe('CONFIRM')
  })

  it('cancels an under-quorum event once the deadline passes', () => {
    const overdue = { ...base, confirmationDeadline: new Date(NOW.getTime() - 1) }
    expect(resolveEventSweep({ event: overdue, registrationCount: 2, now: NOW })).toBe('CANCEL')
  })

  it('cancels with zero registrations after the deadline', () => {
    const overdue = { ...base, confirmationDeadline: new Date(NOW.getTime() - 1) }
    expect(resolveEventSweep({ event: overdue, registrationCount: 0, now: NOW })).toBe('CANCEL')
  })

  it('closes the join window but keeps waiting before the deadline', () => {
    const closed = { ...base, registrationClosesAt: new Date(NOW.getTime() - 1) }
    expect(resolveEventSweep({ event: closed, registrationCount: 2, now: NOW })).toBe(
      'CLOSE_REGISTRATION',
    )
  })

  it('does nothing to an already settled event', () => {
    for (const status of ['CONFIRMED', 'CANCELLED'] as const) {
      const settled = { ...base, status, confirmationDeadline: new Date(NOW.getTime() - 1) }
      expect(resolveEventSweep({ event: settled, registrationCount: 0, now: NOW })).toBe('NONE')
    }
  })

  it('prefers confirming over cancelling when quorum lands exactly at the deadline', () => {
    const overdue = { ...base, confirmationDeadline: new Date(NOW.getTime() - 1) }
    expect(resolveEventSweep({ event: overdue, registrationCount: 3, now: NOW })).toBe('CONFIRM')
  })
})

describe('evaluateRegistration', () => {
  it('awards the event points to a valid main character', () => {
    const result = evaluateRegistration(registrationParams())
    expect(result).toEqual({
      ok: true,
      value: { creditUserId: 'user-1', creditCharacterId: 'char-1', points: 100 },
    })
  })

  it('credits an alt to its main character', () => {
    const result = evaluateRegistration(
      registrationParams({
        character: character({ id: 'alt-1', kind: 'ALT', mainCharacterId: 'char-main' }),
      }),
    )
    expect(result.ok && result.value.creditCharacterId).toBe('char-main')
  })

  it('blocks alts entirely when the guild disallows alt points', () => {
    const result = evaluateRegistration(
      registrationParams({
        character: character({ kind: 'ALT', mainCharacterId: 'char-main' }),
        settings: { ...settings, altPointsPolicy: 'NO_CREDIT' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.code).toBe('ALT_NOT_ELIGIBLE')
  })

  it('refuses a character owned by somebody else', () => {
    const result = evaluateRegistration(
      registrationParams({ character: character({ userId: 'someone-else' }) }),
    )
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses once the code lifetime has elapsed', () => {
    const result = evaluateRegistration(
      registrationParams({
        event: event({ registrationClosesAt: new Date(NOW.getTime() - 1) }),
      }),
    )
    expect(!result.ok && result.code).toBe('CODE_EXPIRED')
  })

  it('allows a registration in the final instant before expiry', () => {
    const result = evaluateRegistration(
      registrationParams({ event: event({ registrationClosesAt: new Date(NOW.getTime() + 1) }) }),
    )
    expect(result.ok).toBe(true)
  })

  it('refuses a second registration from the same account', () => {
    const result = evaluateRegistration(registrationParams({ accountAlreadyRegistered: true }))
    expect(!result.ok && result.code).toBe('ALREADY_REGISTERED')
  })

  it('enforces the minimum level', () => {
    const result = evaluateRegistration(
      registrationParams({ character: character({ level: 9 }) }),
    )
    expect(!result.ok && result.code).toBe('LEVEL_TOO_LOW')
  })

  it('enforces the daily registration cap', () => {
    const result = evaluateRegistration(registrationParams({ registrationsLast24h: 12 }))
    expect(!result.ok && result.code).toBe('RATE_LIMITED')
  })

  it('refuses a banned account', () => {
    const restrictions: RestrictionLike[] = [
      { type: 'BAN', startsAt: new Date(NOW.getTime() - 1000), expiresAt: null, revokedAt: null },
    ]
    const result = evaluateRegistration(registrationParams({ restrictions }))
    expect(!result.ok && result.code).toBe('ACCOUNT_BANNED')
  })

  it('refuses an account restricted from events only', () => {
    const restrictions: RestrictionLike[] = [
      { type: 'NO_EVENTS', startsAt: new Date(NOW.getTime() - 1000), expiresAt: null, revokedAt: null },
    ]
    const result = evaluateRegistration(registrationParams({ restrictions }))
    expect(!result.ok && result.code).toBe('RESTRICTED')
  })

  it('refuses a cancelled event', () => {
    const result = evaluateRegistration(
      registrationParams({ event: event({ status: 'CANCELLED' }) }),
    )
    expect(!result.ok && result.code).toBe('EVENT_CANCELLED')
  })

  it('refuses a character from another guild', () => {
    const result = evaluateRegistration(
      registrationParams({ character: character({ guildId: 'other-guild' }) }),
    )
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })
})

describe('the lone admin cannot pay themselves', () => {
  it('refuses the admin who created the event from redeeming its own code', () => {
    const result = evaluateRegistration(
      registrationParams({
        actor: actor({ id: 'admin-1', role: 'LEADER' }),
        character: character({ userId: 'admin-1' }),
        event: event({ createdByUserId: 'admin-1' }),
      }),
    )
    expect(!result.ok && result.code).toBe('SELF_REGISTRATION_FORBIDDEN')
  })

  it('refuses it through one of their alts, because the check is on the account', () => {
    const result = evaluateRegistration(
      registrationParams({
        actor: actor({ id: 'admin-1', role: 'LEADER' }),
        character: character({ id: 'alt-1', userId: 'admin-1', kind: 'ALT', mainCharacterId: 'main-1' }),
        event: event({ createdByUserId: 'admin-1' }),
      }),
    )
    expect(!result.ok && result.code).toBe('SELF_REGISTRATION_FORBIDDEN')
  })

  it('still lets everybody else redeem the code', () => {
    const result = evaluateRegistration(
      registrationParams({ event: event({ createdByUserId: 'someone-else' }) }),
    )
    expect(result.ok).toBe(true)
  })

  it('treats the guild quorum as a floor, not a default', () => {
    // settings.minParticipants is 3 in these fixtures.
    const below = resolveEventQuorum({ requested: 2, settings })
    expect(!below.ok && below.code).toBe('INVALID_QUORUM')

    const one = resolveEventQuorum({ requested: 1, settings })
    expect(!one.ok && one.code).toBe('INVALID_QUORUM')

    expect(resolveEventQuorum({ requested: 3, settings }).ok).toBe(true)
    expect(resolveEventQuorum({ requested: 50, settings }).ok).toBe(true)
  })

  it('falls back to the guild quorum when the admin sets none', () => {
    const result = resolveEventQuorum({ requested: undefined, settings })
    expect(result.ok && result.value).toBe(3)
  })

  it('refuses a quorum that is not a whole number above zero', () => {
    for (const requested of [0, -1, 2.5]) {
      const result = resolveEventQuorum({ requested, settings })
      expect(!result.ok && result.code).toBe('INVALID_QUORUM')
    }
  })

  it('never lets a guild configure its way below one participant', () => {
    const result = resolveEventQuorum({
      requested: undefined,
      settings: { ...settings, minParticipants: 0 },
    })
    expect(result.ok && result.value).toBe(1)
  })
})

describe('evaluateAdminGrant', () => {
  const admin = actor({ id: 'admin-1', role: 'LEADER' })
  const targetAccount = {
    id: 'user-2',
    guildId: GUILD,
    status: 'ACTIVE' as const,
    isActive: true,
    deletedAt: null,
  }

  function grantParams(overrides: Record<string, unknown> = {}) {
    return {
      actor: admin,
      event: event(),
      targetCharacter: character({ id: 'char-2', userId: 'user-2' }),
      targetAccount,
      targetRestrictions: [] as RestrictionLike[],
      accountAlreadyRegistered: false,
      settings,
      now: NOW,
      ...overrides,
    } as Parameters<typeof evaluateAdminGrant>[0]
  }

  it('lets an admin score another member', () => {
    const result = evaluateAdminGrant(grantParams())
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.points).toBe(100)
  })

  it('refuses an admin scoring their own character', () => {
    const result = evaluateAdminGrant(
      grantParams({
        targetCharacter: character({ id: 'char-a', userId: 'admin-1' }),
        targetAccount: { ...targetAccount, id: 'admin-1' },
      }),
    )
    expect(!result.ok && result.code).toBe('SELF_GRANT_FORBIDDEN')
  })

  it('refuses an admin routing points through their own alt', () => {
    const result = evaluateAdminGrant(
      grantParams({
        // The alt belongs to the admin's account even though it is a different
        // character: the check is on the owning user, so this must fail.
        targetCharacter: character({
          id: 'alt-of-admin',
          userId: 'admin-1',
          kind: 'ALT',
          mainCharacterId: 'char-a',
        }),
        targetAccount: { ...targetAccount, id: 'admin-1' },
      }),
    )
    expect(!result.ok && result.code).toBe('SELF_GRANT_FORBIDDEN')
  })

  it('requires an admin role', () => {
    const result = evaluateAdminGrant(grantParams({ actor: actor({ id: 'plain', role: 'MEMBER' }) }))
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses granting points for a cancelled event', () => {
    const result = evaluateAdminGrant(grantParams({ event: event({ status: 'CANCELLED' }) }))
    expect(!result.ok && result.code).toBe('EVENT_CANCELLED')
  })

  it('flags a large award for second-admin approval', () => {
    const result = evaluateAdminGrant(grantParams({ event: event({ pointsValue: 501 }) }))
    expect(result.ok && result.value.needsSecondApproval).toBe(true)
  })

  it('does not flag an award at the threshold', () => {
    const result = evaluateAdminGrant(grantParams({ event: event({ pointsValue: 500 }) }))
    expect(result.ok && result.value.needsSecondApproval).toBe(false)
  })

  it('refuses a banned target', () => {
    const result = evaluateAdminGrant(
      grantParams({
        targetRestrictions: [
          { type: 'BAN', startsAt: new Date(NOW.getTime() - 1), expiresAt: null, revokedAt: null },
        ],
      }),
    )
    expect(!result.ok && result.code).toBe('ACCOUNT_BANNED')
  })
})

describe('planPointsChange', () => {
  const registrations = [
    { id: 'r1', userId: 'u1', characterId: 'c1', status: 'CONFIRMED' as const },
    { id: 'r2', userId: 'u2', characterId: 'c2', status: 'PENDING' as const },
    { id: 'r3', userId: 'u3', characterId: 'c3', status: 'REVERSED' as const },
  ]

  it('emits one delta per live registration when points go up', () => {
    const plan = planPointsChange({ oldPoints: 100, newPoints: 150, registrations })
    expect(plan.delta).toBe(50)
    expect(plan.adjustments).toHaveLength(2)
    expect(plan.adjustments.every((a) => a.amount === 50)).toBe(true)
  })

  it('preserves each registration state so pending points stay pending', () => {
    const plan = planPointsChange({ oldPoints: 100, newPoints: 150, registrations })
    expect(plan.adjustments.find((a) => a.registrationId === 'r1')?.state).toBe('CONFIRMED')
    expect(plan.adjustments.find((a) => a.registrationId === 'r2')?.state).toBe('PENDING')
  })

  it('never touches a reversed registration', () => {
    const plan = planPointsChange({ oldPoints: 100, newPoints: 150, registrations })
    expect(plan.adjustments.some((a) => a.registrationId === 'r3')).toBe(false)
  })

  it('emits negative deltas when points go down', () => {
    const plan = planPointsChange({ oldPoints: 100, newPoints: 40, registrations })
    expect(plan.delta).toBe(-60)
    expect(plan.adjustments.every((a) => a.amount === -60)).toBe(true)
  })

  it('is a no-op when the value is unchanged', () => {
    const plan = planPointsChange({ oldPoints: 100, newPoints: 100, registrations })
    expect(plan).toEqual({ delta: 0, adjustments: [] })
  })

  it('leaves the sum consistent with the new value', () => {
    // A member on 100 points who receives a +50 delta must end on exactly 150.
    const plan = planPointsChange({ oldPoints: 100, newPoints: 150, registrations })
    const adjustment = plan.adjustments.find((a) => a.registrationId === 'r1')
    const balance = computeBalance([
      { amount: 100, state: 'CONFIRMED' },
      { amount: adjustment?.amount ?? 0, state: 'CONFIRMED' },
    ])
    expect(balance.available).toBe(150)
  })
})

describe('evaluateBid', () => {
  const auction: AuctionLike = {
    id: 'auction-1',
    guildId: GUILD,
    status: 'OPEN',
    startingBid: 100,
    minIncrement: 10,
    currentBid: null,
    currentBidderUserId: null,
    endsAt: new Date(NOW.getTime() + 3_600_000),
  }

  function bidParams(overrides: Record<string, unknown> = {}) {
    return {
      auction,
      actor: actor(),
      character: character(),
      restrictions: [] as RestrictionLike[],
      availablePoints: 1000,
      amount: 100,
      now: NOW,
      ...overrides,
    } as Parameters<typeof evaluateBid>[0]
  }

  it('accepts a valid opening bid from a main character', () => {
    expect(evaluateBid(bidParams()).ok).toBe(true)
  })

  it('refuses an alt character', () => {
    const result = evaluateBid(
      bidParams({ character: character({ kind: 'ALT', mainCharacterId: 'char-main' }) }),
    )
    expect(!result.ok && result.code).toBe('MAIN_CHARACTER_REQUIRED')
  })

  it('refuses a bid above the confirmed balance', () => {
    const result = evaluateBid(bidParams({ amount: 200, availablePoints: 199 }))
    expect(!result.ok && result.code).toBe('INSUFFICIENT_POINTS')
  })

  it('ignores pending points entirely', () => {
    // 0 confirmed means no bid is fundable, however large the pending pile is.
    const result = evaluateBid(bidParams({ availablePoints: 0 }))
    expect(!result.ok && result.code).toBe('INSUFFICIENT_POINTS')
  })

  it('enforces the minimum increment over the standing bid', () => {
    const contested = { ...auction, currentBid: 100, currentBidderUserId: 'user-9' }
    expect(minimumBid(contested)).toBe(110)
    const result = evaluateBid(bidParams({ auction: contested, amount: 109 }))
    expect(!result.ok && result.code).toBe('BID_TOO_LOW')
  })

  it('refuses bidding against yourself', () => {
    const contested = { ...auction, currentBid: 100, currentBidderUserId: 'user-1' }
    const result = evaluateBid(bidParams({ auction: contested, amount: 200 }))
    expect(!result.ok && result.code).toBe('ALREADY_WINNING')
  })

  it('refuses after the auction ends', () => {
    const ended = { ...auction, endsAt: new Date(NOW.getTime() - 1) }
    const result = evaluateBid(bidParams({ auction: ended }))
    expect(!result.ok && result.code).toBe('AUCTION_ENDED')
  })

  it('refuses a fractional or negative amount', () => {
    expect(!evaluateBid(bidParams({ amount: 10.5 })).ok).toBe(true)
    expect(!evaluateBid(bidParams({ amount: -5 })).ok).toBe(true)
  })

  it('refuses a member barred from auctions', () => {
    const result = evaluateBid(
      bidParams({
        restrictions: [
          { type: 'NO_AUCTION', startsAt: new Date(NOW.getTime() - 1), expiresAt: null, revokedAt: null },
        ],
      }),
    )
    expect(!result.ok && result.code).toBe('RESTRICTED')
  })
})

describe('applyAntiSnipe', () => {
  it('extends an auction when a bid lands inside the window', () => {
    const endsAt = new Date(NOW.getTime() + 30_000)
    expect(applyAntiSnipe(endsAt, NOW, 120).getTime()).toBe(NOW.getTime() + 120_000)
  })

  it('leaves a distant end time alone', () => {
    const endsAt = new Date(NOW.getTime() + 600_000)
    expect(applyAntiSnipe(endsAt, NOW, 120)).toBe(endsAt)
  })

  it('is a no-op when disabled', () => {
    const endsAt = new Date(NOW.getTime() + 1_000)
    expect(applyAntiSnipe(endsAt, NOW, 0)).toBe(endsAt)
  })
})

describe('restrictions and account access', () => {
  it('ignores a revoked restriction', () => {
    const restriction: RestrictionLike = {
      type: 'BAN',
      startsAt: new Date(NOW.getTime() - 1000),
      expiresAt: null,
      revokedAt: new Date(NOW.getTime() - 1),
    }
    expect(isRestrictionInForce(restriction, NOW)).toBe(false)
  })

  it('ignores an expired restriction', () => {
    const restriction: RestrictionLike = {
      type: 'SUSPENSION',
      startsAt: new Date(NOW.getTime() - 1000),
      expiresAt: new Date(NOW.getTime() - 1),
      revokedAt: null,
    }
    expect(isRestrictionInForce(restriction, NOW)).toBe(false)
  })

  it('ignores a restriction that has not started', () => {
    const restriction: RestrictionLike = {
      type: 'BAN',
      startsAt: new Date(NOW.getTime() + 1000),
      expiresAt: null,
      revokedAt: null,
    }
    expect(isRestrictionInForce(restriction, NOW)).toBe(false)
  })

  it('collects only the live restriction types', () => {
    const types = activeRestrictionTypes(
      [
        { type: 'BAN', startsAt: new Date(NOW.getTime() - 1), expiresAt: null, revokedAt: null },
        { type: 'NO_MARKET', startsAt: new Date(NOW.getTime() - 1), expiresAt: new Date(NOW.getTime() - 1), revokedAt: null },
      ],
      NOW,
    )
    expect([...types]).toEqual(['BAN'])
  })

  it('reports a deleted account before anything else', () => {
    const result = evaluateAccountAccess(
      { status: 'ACTIVE', isActive: true, deletedAt: NOW },
      [],
      NOW,
    )
    expect(!result.ok && result.code).toBe('ACCOUNT_DELETED')
  })

  it('reports an inactive account', () => {
    const result = evaluateAccountAccess(
      { status: 'ACTIVE', isActive: false, deletedAt: null },
      [],
      NOW,
    )
    expect(!result.ok && result.code).toBe('ACCOUNT_INACTIVE')
  })

  it('reports a lockout', () => {
    const result = evaluateAccountAccess(
      { status: 'ACTIVE', isActive: true, deletedAt: null, lockedUntil: new Date(NOW.getTime() + 1000) },
      [],
      NOW,
    )
    expect(!result.ok && result.code).toBe('ACCOUNT_LOCKED')
  })

  it('lets a lapsed ban through rather than trusting a stale status column', () => {
    const result = evaluateAccountAccess(
      { status: 'BANNED', isActive: true, deletedAt: null },
      [{ type: 'BAN', startsAt: new Date(NOW.getTime() - 2000), expiresAt: new Date(NOW.getTime() - 1), revokedAt: null }],
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  it('derives the status column from the live restrictions', () => {
    expect(
      deriveUserStatus({ status: 'ACTIVE', isActive: true, deletedAt: null }, [], NOW),
    ).toBe('ACTIVE')
    expect(
      deriveUserStatus({ status: 'ACTIVE', isActive: false, deletedAt: null }, [], NOW),
    ).toBe('INACTIVE')
    expect(
      deriveUserStatus(
        { status: 'ACTIVE', isActive: true, deletedAt: null },
        [{ type: 'BAN', startsAt: new Date(NOW.getTime() - 1), expiresAt: null, revokedAt: null }],
        NOW,
      ),
    ).toBe('BANNED')
    expect(
      deriveUserStatus({ status: 'ACTIVE', isActive: true, deletedAt: NOW }, [], NOW),
    ).toBe('DELETED')
  })
})

describe('object-level authorization', () => {
  it('lets the owner through', () => {
    const result = authorizeResource({
      actor: actor(),
      ownerUserId: 'user-1',
      resourceGuildId: GUILD,
    })
    expect(result.ok && result.value.viaAdmin).toBe(false)
  })

  it('lets an admin of the same guild through', () => {
    const result = authorizeResource({
      actor: actor({ id: 'admin', role: 'LEADER' }),
      ownerUserId: 'user-1',
      resourceGuildId: GUILD,
    })
    expect(result.ok && result.value.viaAdmin).toBe(true)
  })

  it('refuses another member', () => {
    const result = authorizeResource({
      actor: actor({ id: 'stranger' }),
      ownerUserId: 'user-1',
      resourceGuildId: GUILD,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses an admin from a different guild', () => {
    const result = authorizeResource({
      actor: actor({ id: 'admin', role: 'LEADER', guildId: 'other' }),
      ownerUserId: 'user-1',
      resourceGuildId: GUILD,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('can lock a resource to its owner alone', () => {
    const result = authorizeResource({
      actor: actor({ id: 'admin', role: 'LEADER' }),
      ownerUserId: 'user-1',
      resourceGuildId: GUILD,
      allowAdminOverride: false,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('recognises exactly the admin roles', () => {
    expect(isGuildAdmin('MEMBER')).toBe(false)
    expect(isGuildAdmin('VICE_LEADER')).toBe(true)
    expect(isGuildAdmin('LEADER')).toBe(true)
    expect(isGuildAdmin('SUPER_ADMIN')).toBe(true)
  })
})

describe('moderation authority', () => {
  const leader = actor({ id: 'leader', role: 'LEADER' })

  it('lets a leader moderate a member', () => {
    expect(
      authorizeModeration({
        actor: leader,
        target: { id: 'm', guildId: GUILD, role: 'MEMBER' },
      }).ok,
    ).toBe(true)
  })

  it('refuses self-moderation', () => {
    const result = authorizeModeration({
      actor: leader,
      target: { id: 'leader', guildId: GUILD, role: 'LEADER' },
    })
    expect(!result.ok && result.code).toBe('SELF_MODERATION_FORBIDDEN')
  })

  it('refuses moderating a peer', () => {
    const result = authorizeModeration({
      actor: actor({ id: 'vice-a', role: 'VICE_LEADER' }),
      target: { id: 'vice-b', guildId: GUILD, role: 'VICE_LEADER' },
    })
    expect(!result.ok && result.code).toBe('INSUFFICIENT_RANK')
  })

  it('refuses a vice-leader banning the leader', () => {
    const result = authorizeModeration({
      actor: actor({ id: 'vice', role: 'VICE_LEADER' }),
      target: { id: 'leader', guildId: GUILD, role: 'LEADER' },
    })
    expect(!result.ok && result.code).toBe('INSUFFICIENT_RANK')
  })

  it('refuses promoting somebody to your own rank', () => {
    const result = authorizeRoleChange({
      actor: actor({ id: 'vice', role: 'VICE_LEADER' }),
      target: { id: 'm', guildId: GUILD, role: 'MEMBER' },
      newRole: 'VICE_LEADER',
    })
    expect(!result.ok && result.code).toBe('INSUFFICIENT_RANK')
  })

  it('allows a leader to appoint a vice-leader', () => {
    expect(
      authorizeRoleChange({
        actor: leader,
        target: { id: 'm', guildId: GUILD, role: 'MEMBER' },
        newRole: 'VICE_LEADER',
      }).ok,
    ).toBe(true)
  })
})

describe('resolveCodeExpiry', () => {
  it('accepts a lifetime within the cap', () => {
    const result = resolveCodeExpiry({ ttlMinutes: 30, settings, now: NOW })
    expect(result.ok && result.value.getTime()).toBe(NOW.getTime() + 30 * 60_000)
  })

  it('refuses a lifetime beyond the cap', () => {
    const result = resolveCodeExpiry({ ttlMinutes: 721, settings, now: NOW })
    expect(!result.ok && result.code).toBe('INVALID_TTL')
  })

  it('refuses a zero or fractional lifetime', () => {
    expect(resolveCodeExpiry({ ttlMinutes: 0, settings, now: NOW }).ok).toBe(false)
    expect(resolveCodeExpiry({ ttlMinutes: 1.5, settings, now: NOW }).ok).toBe(false)
  })
})

describe('evaluateListingCreate', () => {
  const input = {
    itemName: 'Cora Force Blade',
    itemType: 'WEAPON' as const,
    rarity: 'EPIC' as const,
    itemLevel: 55,
    priceDiamonds: 2500,
    quantity: 1,
  }

  it('accepts a valid listing and trims the name', () => {
    const result = evaluateListingCreate({
      actor: actor(),
      character: character(),
      restrictions: [],
      input: { ...input, itemName: '  Cora Force Blade  ' },
      now: NOW,
    })
    expect(result.ok && result.value.itemName).toBe('Cora Force Blade')
  })

  it('lets an alt list items (only points are main-only)', () => {
    const result = evaluateListingCreate({
      actor: actor(),
      character: character({ kind: 'ALT', mainCharacterId: 'char-main' }),
      restrictions: [],
      input,
      now: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses listing on behalf of another member', () => {
    const result = evaluateListingCreate({
      actor: actor(),
      character: character({ userId: 'someone-else' }),
      restrictions: [],
      input,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a zero or negative price', () => {
    for (const priceDiamonds of [0, -1]) {
      const result = evaluateListingCreate({
        actor: actor(),
        character: character(),
        restrictions: [],
        input: { ...input, priceDiamonds },
        now: NOW,
      })
      expect(!result.ok && result.code).toBe('INVALID_PRICE')
    }
  })

  it('refuses a member barred from the market', () => {
    const result = evaluateListingCreate({
      actor: actor(),
      character: character(),
      restrictions: [
        { type: 'NO_MARKET', startsAt: new Date(NOW.getTime() - 1), expiresAt: null, revokedAt: null },
      ],
      input,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('RESTRICTED')
  })
})

// ---------------------------------------------------------------------------
// Guild invites
// ---------------------------------------------------------------------------

describe('guild invites', () => {
  function invite(overrides: Partial<InviteLike> = {}): InviteLike {
    return {
      id: 'invite-1',
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      redeemedAt: null,
      revokedAt: null,
      ...overrides,
    }
  }

  it('expires exactly 24 hours after it is issued', () => {
    expect(resolveInviteExpiry(NOW).toISOString()).toBe('2026-08-10T12:00:00.000Z')
    expect(INVITE_TTL_HOURS).toBe(24)
  })

  it('accepts a live invite redeemed by a visitor with no account', () => {
    const result = evaluateInviteRedemption({ invite: invite(), actor: null, now: NOW })
    expect(result.ok && result.value.inviteId).toBe('invite-1')
  })

  it('accepts an invite in the final instant before it expires', () => {
    const result = evaluateInviteRedemption({
      invite: invite({ expiresAt: new Date(NOW.getTime() + 1) }),
      actor: null,
      now: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses the invite the instant it expires', () => {
    const result = evaluateInviteRedemption({
      invite: invite({ expiresAt: NOW }),
      actor: null,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVITE_EXPIRED')
  })

  it('refuses a second use', () => {
    const result = evaluateInviteRedemption({
      invite: invite({ redeemedAt: new Date(NOW.getTime() - 1000) }),
      actor: null,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVITE_USED')
  })

  it('refuses a revoked invite even while it is otherwise live', () => {
    const result = evaluateInviteRedemption({
      invite: invite({ revokedAt: new Date(NOW.getTime() - 1000) }),
      actor: null,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVITE_REVOKED')
  })

  it('refuses a caller who already belongs to a guild', () => {
    const result = evaluateInviteRedemption({ invite: invite(), actor: actor(), now: NOW })
    expect(!result.ok && result.code).toBe('ALREADY_IN_GUILD')
  })

  it('reports a status for every combination', () => {
    expect(describeInviteStatus(invite(), NOW)).toBe('LIVE')
    expect(describeInviteStatus(invite({ expiresAt: NOW }), NOW)).toBe('EXPIRED')
    expect(describeInviteStatus(invite({ redeemedAt: NOW }), NOW)).toBe('REDEEMED')
    expect(describeInviteStatus(invite({ revokedAt: NOW }), NOW)).toBe('REVOKED')
    // Revocation outranks everything else, so a revoked invite never reads as used.
    expect(describeInviteStatus(invite({ redeemedAt: NOW, revokedAt: NOW }), NOW)).toBe('REVOKED')
  })

  it('lets only a super admin issue one', () => {
    expect(authorizeInviteIssue(actor({ role: 'SUPER_ADMIN' })).ok).toBe(true)

    for (const role of ['MEMBER', 'VICE_LEADER', 'LEADER'] as const) {
      const result = authorizeInviteIssue(actor({ role }))
      expect(!result.ok && result.code).toBe('FORBIDDEN')
    }
  })

  it('refuses a deactivated super admin', () => {
    const result = authorizeInviteIssue(actor({ role: 'SUPER_ADMIN', isActive: false }))
    expect(!result.ok && result.code).toBe('ACCOUNT_INACTIVE')
  })
})

// ---------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------

describe('joining a guild', () => {
  function guild(overrides: Partial<GuildJoinLike> = {}): GuildJoinLike {
    return { id: GUILD, isActive: true, joinPolicy: 'OPEN', ...overrides }
  }

  function memberInvite(overrides: Partial<MemberInviteLike> = {}): MemberInviteLike {
    return {
      id: 'invite-1',
      guildId: GUILD,
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      maxUses: 1,
      usedCount: 0,
      revokedAt: null,
      ...overrides,
    }
  }

  it('lets anyone into an open guild with no link at all', () => {
    const result = evaluateJoin({ guild: guild(), invite: null, now: NOW })
    expect(result.ok && result.value).toEqual({ guildId: GUILD, inviteId: null })
  })

  it('refuses an open signup once the guild closed itself', () => {
    const result = evaluateJoin({
      guild: guild({ joinPolicy: 'INVITE_ONLY' }),
      invite: null,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVITE_REQUIRED')
  })

  it('lets a live link into a closed guild', () => {
    const result = evaluateJoin({
      guild: guild({ joinPolicy: 'INVITE_ONLY' }),
      invite: memberInvite(),
      now: NOW,
    })
    expect(result.ok && result.value.inviteId).toBe('invite-1')
  })

  it('refuses a link issued for another guild without saying so', () => {
    const result = evaluateJoin({
      guild: guild(),
      invite: memberInvite({ guildId: 'other-guild' }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVITE_INVALID')
  })

  it('refuses an inactive guild even to somebody holding a valid link', () => {
    const result = evaluateJoin({
      guild: guild({ isActive: false }),
      invite: memberInvite(),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('GUILD_NOT_FOUND')
  })

  it('counts seats: the last one works, the next does not', () => {
    const nearlyFull = memberInvite({ maxUses: 3, usedCount: 2 })
    expect(evaluateJoin({ guild: guild(), invite: nearlyFull, now: NOW }).ok).toBe(true)

    const full = evaluateJoin({
      guild: guild(),
      invite: memberInvite({ maxUses: 3, usedCount: 3 }),
      now: NOW,
    })
    expect(!full.ok && full.code).toBe('INVITE_EXHAUSTED')
  })

  it('refuses an expired or revoked link', () => {
    const expired = evaluateJoin({
      guild: guild(),
      invite: memberInvite({ expiresAt: NOW }),
      now: NOW,
    })
    expect(!expired.ok && expired.code).toBe('INVITE_EXPIRED')

    const revoked = evaluateJoin({
      guild: guild(),
      invite: memberInvite({ revokedAt: NOW }),
      now: NOW,
    })
    expect(!revoked.ok && revoked.code).toBe('INVITE_REVOKED')
  })

  it('reports a status for every combination, revocation first', () => {
    expect(describeMemberInviteStatus(memberInvite(), NOW)).toBe('LIVE')
    expect(describeMemberInviteStatus(memberInvite({ expiresAt: NOW }), NOW)).toBe('EXPIRED')
    expect(describeMemberInviteStatus(memberInvite({ usedCount: 1 }), NOW)).toBe('EXHAUSTED')
    expect(
      describeMemberInviteStatus(memberInvite({ usedCount: 1, revokedAt: NOW }), NOW),
    ).toBe('REVOKED')
  })
})

describe('issuing a recruitment link', () => {
  const admin = actor({ role: 'VICE_LEADER' })

  it('lets a guild admin issue one', () => {
    const result = evaluateMemberInviteIssue({
      actor: admin,
      guildId: GUILD,
      maxUses: 10,
      ttlHours: 24,
      now: NOW,
    })
    expect(result.ok && result.value.maxUses).toBe(10)
    expect(result.ok && result.value.expiresAt.toISOString()).toBe('2026-08-10T12:00:00.000Z')
  })

  it('refuses a plain member', () => {
    const result = evaluateMemberInviteIssue({
      actor: actor(),
      guildId: GUILD,
      maxUses: 1,
      ttlHours: 24,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses an admin of another guild', () => {
    const result = evaluateMemberInviteIssue({
      actor: actor({ role: 'LEADER', guildId: 'other' }),
      guildId: GUILD,
      maxUses: 1,
      ttlHours: 24,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('bounds the number of seats', () => {
    for (const maxUses of [0, -1, 2.5, MEMBER_INVITE_MAX_USES + 1]) {
      const result = evaluateMemberInviteIssue({
        actor: admin,
        guildId: GUILD,
        maxUses,
        ttlHours: 24,
        now: NOW,
      })
      expect(!result.ok && result.code).toBe('INVALID_USES')
    }
    expect(
      evaluateMemberInviteIssue({
        actor: admin,
        guildId: GUILD,
        maxUses: MEMBER_INVITE_MAX_USES,
        ttlHours: 24,
        now: NOW,
      }).ok,
    ).toBe(true)
  })

  it('bounds how long it lives', () => {
    for (const ttlHours of [0, -3, MEMBER_INVITE_MAX_TTL_HOURS + 1]) {
      const result = evaluateMemberInviteIssue({
        actor: admin,
        guildId: GUILD,
        maxUses: 1,
        ttlHours,
        now: NOW,
      })
      expect(!result.ok && result.code).toBe('INVALID_TTL')
    }
    expect(
      evaluateMemberInviteIssue({
        actor: admin,
        guildId: GUILD,
        maxUses: 1,
        ttlHours: MEMBER_INVITE_MAX_TTL_HOURS,
        now: NOW,
      }).ok,
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Character roster
// ---------------------------------------------------------------------------

const BAN: RestrictionLike = {
  type: 'BAN',
  startsAt: new Date(NOW.getTime() - 1),
  expiresAt: null,
  revokedAt: null,
}

function draft(overrides: Partial<CharacterDraft> = {}): CharacterDraft {
  return { name: 'Nova', race: 'BELLATO', biosuit: 'Assault', level: 30, kind: 'MAIN', ...overrides }
}

const MAIN = character({ id: 'main-1', kind: 'MAIN', mainCharacterId: null })
const ALT = character({ id: 'alt-1', kind: 'ALT', mainCharacterId: 'main-1' })

describe('adding a character', () => {
  it('creates the first character of an account as its main', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft(),
      now: NOW,
    })
    expect(result.ok && result.value.character.kind).toBe('MAIN')
    expect(result.ok && result.value.mainCharacterId).toBeNull()
    expect(result.ok && result.value.adoptAltIds).toEqual([])
  })

  it('links a new alt to the existing main', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [MAIN],
      input: draft({ kind: 'ALT' }),
      now: NOW,
    })
    expect(result.ok && result.value.mainCharacterId).toBe('main-1')
  })

  it('refuses an alt while the account has no main to roll up to', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ kind: 'ALT' }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('MAIN_REQUIRED')
  })

  it('refuses a second main', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [MAIN],
      input: draft({ kind: 'MAIN' }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('MAIN_ALREADY_EXISTS')
  })

  it('refuses a second main even when the existing one is retired', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [character({ id: 'main-1', kind: 'MAIN', isActive: false })],
      input: draft({ kind: 'MAIN' }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('MAIN_ALREADY_EXISTS')
  })

  it('adopts the alts that were created before any main existed', () => {
    const orphanA = character({ id: 'alt-a', kind: 'ALT', mainCharacterId: null })
    const orphanB = character({ id: 'alt-b', kind: 'ALT', mainCharacterId: null })

    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [orphanA, orphanB],
      input: draft({ kind: 'MAIN' }),
      now: NOW,
    })
    expect(result.ok && result.value.adoptAltIds).toEqual(['alt-a', 'alt-b'])
  })

  it('refuses one character past the roster cap', () => {
    const roster = Array.from({ length: MAX_CHARACTERS_PER_ACCOUNT }, (_, i) =>
      character({ id: `c-${i}`, kind: i === 0 ? 'MAIN' : 'ALT', mainCharacterId: i === 0 ? null : 'c-0' }),
    )

    expect(
      evaluateCharacterCreate({
        actor: actor(),
        restrictions: [],
        roster: roster.slice(0, MAX_CHARACTERS_PER_ACCOUNT - 1),
        input: draft({ kind: 'ALT' }),
        now: NOW,
      }).ok,
    ).toBe(true)

    const full = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster,
      input: draft({ kind: 'ALT' }),
      now: NOW,
    })
    expect(!full.ok && full.code).toBe('ROSTER_FULL')
  })

  it('counts retired characters against the cap, because their name is never released', () => {
    const roster = [
      MAIN,
      ...Array.from({ length: MAX_CHARACTERS_PER_ACCOUNT - 1 }, (_, i) =>
        character({ id: `dead-${i}`, kind: 'ALT', mainCharacterId: 'main-1', isActive: false }),
      ),
    ]
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster,
      input: draft({ kind: 'ALT' }),
      now: NOW,
    })
    // Otherwise a create-and-retire loop reserves every name in the guild.
    expect(!result.ok && result.code).toBe('ROSTER_FULL')
  })

  it('accepts the name and biosuit at their maximum length and refuses one character more', () => {
    const name = 'n'.repeat(40)
    const biosuit = 'b'.repeat(60)

    expect(
      evaluateCharacterCreate({
        actor: actor(),
        restrictions: [],
        roster: [],
        input: draft({ name, biosuit }),
        now: NOW,
      }).ok,
    ).toBe(true)

    const longName = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ name: `${name}n` }),
      now: NOW,
    })
    expect(!longName.ok && longName.code).toBe('INVALID_NAME')

    const longBiosuit = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ biosuit: `${biosuit}b` }),
      now: NOW,
    })
    expect(!longBiosuit.ok && longBiosuit.code).toBe('INVALID_BIOSUIT')
  })

  it('refuses a biosuit carrying control characters', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ biosuit: `Ass${String.fromCharCode(0)}ault` }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVALID_BIOSUIT')
  })

  it('trims the name and refuses one shorter than two characters', () => {
    const trimmed = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ name: '  Nova  ' }),
      now: NOW,
    })
    expect(trimmed.ok && trimmed.value.character.name).toBe('Nova')

    const tooShort = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ name: ' a ' }),
      now: NOW,
    })
    expect(!tooShort.ok && tooShort.code).toBe('INVALID_NAME')
  })

  it('refuses a name carrying control characters', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ name: `No${String.fromCharCode(7)}va` }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVALID_NAME')
  })

  it('refuses a level outside 1 to 999', () => {
    for (const level of [0, -1, 1000, 12.5]) {
      const result = evaluateCharacterCreate({
        actor: actor(),
        restrictions: [],
        roster: [],
        input: draft({ level }),
        now: NOW,
      })
      expect(!result.ok && result.code).toBe('INVALID_LEVEL')
    }

    for (const level of [1, 999]) {
      expect(
        evaluateCharacterCreate({
          actor: actor(),
          restrictions: [],
          roster: [],
          input: draft({ level }),
          now: NOW,
        }).ok,
      ).toBe(true)
    }
  })

  it('refuses a blank biosuit', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [],
      input: draft({ biosuit: '   ' }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVALID_BIOSUIT')
  })

  it('refuses a banned account', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [BAN],
      roster: [],
      input: draft(),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('ACCOUNT_BANNED')
  })

  it('refuses a roster that does not belong to the caller', () => {
    const result = evaluateCharacterCreate({
      actor: actor(),
      restrictions: [],
      roster: [character({ id: 'main-1', userId: 'someone-else' })],
      input: draft({ kind: 'ALT' }),
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })
})

describe('editing a character', () => {
  const patch = { name: 'Nova Prime', biosuit: 'Ranger', level: 55 }

  it('accepts the owner and normalises the fields', () => {
    const result = evaluateCharacterUpdate({
      actor: actor(),
      restrictions: [],
      character: MAIN,
      input: { ...patch, name: '  Nova Prime ' },
      now: NOW,
    })
    expect(result.ok && result.value).toEqual(patch)
  })

  it('refuses editing another member character', () => {
    const result = evaluateCharacterUpdate({
      actor: actor({ id: 'stranger' }),
      restrictions: [],
      character: MAIN,
      input: patch,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses editing a character from another guild', () => {
    const result = evaluateCharacterUpdate({
      actor: actor(),
      restrictions: [],
      character: character({ guildId: 'other-guild' }),
      input: patch,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses editing a retired character', () => {
    const result = evaluateCharacterUpdate({
      actor: actor(),
      restrictions: [],
      character: character({ isActive: false }),
      input: patch,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('CHARACTER_INACTIVE')
  })

  it('refuses a banned account', () => {
    const result = evaluateCharacterUpdate({
      actor: actor(),
      restrictions: [BAN],
      character: MAIN,
      input: patch,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('ACCOUNT_BANNED')
  })

  it('applies the same field bounds as creation', () => {
    const level = evaluateCharacterUpdate({
      actor: actor(),
      restrictions: [],
      character: MAIN,
      input: { ...patch, level: 1000 },
      now: NOW,
    })
    expect(!level.ok && level.code).toBe('INVALID_LEVEL')

    const name = evaluateCharacterUpdate({
      actor: actor(),
      restrictions: [],
      character: MAIN,
      input: { ...patch, name: 'x' },
      now: NOW,
    })
    expect(!name.ok && name.code).toBe('INVALID_NAME')
  })
})

describe('switching the main character', () => {
  it('demotes the current main and promotes the chosen alt', () => {
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(result.ok && result.value.newMainId).toBe('alt-1')
    expect(result.ok && result.value.demoteMainId).toBe('main-1')
    expect(result.ok && result.value.relinkAltIds).toEqual([])
  })

  it('relinks every other alt to the new main', () => {
    const second = character({ id: 'alt-2', kind: 'ALT', mainCharacterId: 'main-1' })
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT, second],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(result.ok && result.value.relinkAltIds).toEqual(['alt-2'])
  })

  it('promotes an orphan alt when the account has no main at all', () => {
    const orphan = character({ id: 'alt-1', kind: 'ALT', mainCharacterId: null })
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [],
      roster: [orphan],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(result.ok && result.value.demoteMainId).toBeNull()
  })

  it('refuses promoting the character that is already the main', () => {
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT],
      targetCharacterId: 'main-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('ALREADY_MAIN')
  })

  it('refuses promoting a retired character', () => {
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, character({ id: 'alt-1', kind: 'ALT', isActive: false })],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('CHARACTER_INACTIVE')
  })

  it('refuses a character id that is not on the roster', () => {
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT],
      targetCharacterId: 'someone-elses-character',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a banned account', () => {
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [BAN],
      roster: [MAIN, ALT],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('ACCOUNT_BANNED')
  })

  it('refuses a roster that does not belong to the caller', () => {
    const result = evaluateMainSwitch({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, character({ id: 'alt-1', kind: 'ALT', userId: 'someone-else' })],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })
})

describe('retiring a character', () => {
  it('retires an alt', () => {
    const result = evaluateCharacterRetire({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(result.ok && result.value.characterId).toBe('alt-1')
  })

  it('refuses retiring the main while another character depends on it', () => {
    const result = evaluateCharacterRetire({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT],
      targetCharacterId: 'main-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('MAIN_CANNOT_RETIRE')
  })

  it('refuses retiring the last character an account has', () => {
    const result = evaluateCharacterRetire({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, character({ id: 'alt-1', kind: 'ALT', isActive: false })],
      targetCharacterId: 'main-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('LAST_CHARACTER')
  })

  it('refuses retiring a character that is already retired', () => {
    const result = evaluateCharacterRetire({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT, character({ id: 'alt-2', kind: 'ALT', isActive: false })],
      targetCharacterId: 'alt-2',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('CHARACTER_INACTIVE')
  })

  it('refuses retiring a character that is not on the roster', () => {
    const result = evaluateCharacterRetire({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, ALT],
      targetCharacterId: 'not-mine',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a roster that does not belong to the caller', () => {
    const result = evaluateCharacterRetire({
      actor: actor(),
      restrictions: [],
      roster: [MAIN, character({ id: 'alt-1', kind: 'ALT', userId: 'someone-else' })],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a banned account', () => {
    const result = evaluateCharacterRetire({
      actor: actor(),
      restrictions: [BAN],
      roster: [MAIN, ALT],
      targetCharacterId: 'alt-1',
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('ACCOUNT_BANNED')
  })
})
