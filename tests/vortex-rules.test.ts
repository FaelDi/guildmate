import { describe, expect, it } from 'vitest'
import {
  brtDay,
  buildLootWheel,
  classifyCombatPower,
  computeParticipation,
  evaluateBannerExtend,
  evaluateBetWithdrawal,
  evaluateCharacterStatsUpdate,
  evaluateExcuse,
  evaluateLootBannerCreate,
  evaluateLootBet,
  evaluateLootDraw,
  evaluateMemeDraw,
  evaluatePenalty,
  evaluatePenaltyReversal,
  evaluateThresholdUpdate,
  evaluateWeekAdvance,
  isBannerAcceptingBets,
  LOOT_MAX_ITEMS_PER_BANNER,
  MAX_COMBAT_POWER,
  meetsLootRestriction,
  nextSpawn,
  parseDailyTimes,
  parseWeekdays,
  pickUniformIndex,
  pickWheelSlice,
  resolveBossSchedule,
  validateBossSchedule,
  type Actor,
  type BossSchedule,
  type BuildFlags,
  type CharacterLike,
  type LootBannerLike,
  type LootItemLike,
  type RestrictionLike,
} from '@/lib/rules'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-19T15:00:00.000Z') // 12:00 BRT, a Saturday
const GUILD = '11111111-1111-1111-1111-111111111111'
const HOUR = 3_600_000

function actor(overrides: Partial<Actor> = {}): Actor {
  return { id: 'user-1', guildId: GUILD, role: 'MEMBER', status: 'ACTIVE', isActive: true, ...overrides }
}

const ADMIN = actor({ id: 'admin-1', role: 'LEADER' })
const VICE = actor({ id: 'vice-1', role: 'VICE_LEADER' })

const NO_BUILD: BuildFlags = {
  skill4: false,
  skill5: false,
  skill6: false,
  skill7: false,
  constant3: false,
  painAdaptation: false,
  trinity: false,
  techniqueMaster: false,
}

function main(overrides: Partial<CharacterLike & { combatPower: number; name: string }> = {}) {
  return {
    id: 'char-1',
    userId: 'user-1',
    guildId: GUILD,
    kind: 'MAIN' as const,
    mainCharacterId: null,
    level: 70,
    isActive: true,
    combatPower: 200_000,
    name: 'Nova',
    ...overrides,
  }
}

const THRESHOLDS = { megaCpThreshold: 190_000, titanCpThreshold: 155_000, lootMinParticipationPct: 90 }

function banner(overrides: Partial<LootBannerLike> = {}): LootBannerLike {
  return { id: 'banner-1', guildId: GUILD, status: 'OPEN', closesAt: new Date(NOW.getTime() + HOUR), ...overrides }
}

function item(overrides: Partial<LootItemLike> = {}): LootItemLike {
  return {
    id: 'item-1',
    guildId: GUILD,
    bannerId: 'banner-1',
    status: 'OPEN',
    maxPoints: 100,
    restriction: 'ALL',
    ...overrides,
  }
}

function betParams(overrides: Partial<Parameters<typeof evaluateLootBet>[0]> = {}) {
  return {
    actor: actor(),
    restrictions: [] as RestrictionLike[],
    character: main(),
    banner: banner(),
    item: item(),
    participationPct: 100,
    settings: THRESHOLDS,
    availablePoints: 50,
    hasActiveBet: false,
    points: 10,
    now: NOW,
    ...overrides,
  }
}

function live(type: RestrictionLike['type']): RestrictionLike {
  return { type, startsAt: new Date(NOW.getTime() - 1000), expiresAt: null, revokedAt: null }
}

// ---------------------------------------------------------------------------
// Participation & weeks
// ---------------------------------------------------------------------------

describe('weekly participation', () => {
  it('is 100% in a week with no events yet', () => {
    expect(computeParticipation({ eventsHeld: 0, eventsAttended: 0, eventsExcused: 0 })).toBe(100)
  })

  it('counts attended events over held events, one decimal', () => {
    expect(computeParticipation({ eventsHeld: 39, eventsAttended: 38, eventsExcused: 0 })).toBe(97.4)
  })

  it('counts an excused absence as attended', () => {
    expect(computeParticipation({ eventsHeld: 10, eventsAttended: 8, eventsExcused: 1 })).toBe(90)
  })

  it('never goes above 100% however many absences are excused', () => {
    expect(computeParticipation({ eventsHeld: 4, eventsAttended: 4, eventsExcused: 9 })).toBe(100)
  })

  it('is 0% for a member who attended nothing', () => {
    expect(computeParticipation({ eventsHeld: 5, eventsAttended: 0, eventsExcused: 0 })).toBe(0)
  })

  it('treats a negative held count (all events self-created) as nothing to miss', () => {
    expect(computeParticipation({ eventsHeld: -1, eventsAttended: 0, eventsExcused: 0 })).toBe(100)
  })
})

describe('opening the next week', () => {
  it('opens week 1 when there is none', () => {
    const result = evaluateWeekAdvance({ actor: ADMIN, guildId: GUILD, currentWeek: null, now: NOW })
    expect(result.ok && result.value.number).toBe(1)
  })

  it('increments the week number', () => {
    const result = evaluateWeekAdvance({
      actor: ADMIN,
      guildId: GUILD,
      currentWeek: { number: 7, startedAt: new Date(NOW.getTime() - 5 * 24 * HOUR) },
      now: NOW,
    })
    expect(result.ok && result.value.number).toBe(8)
  })

  it('refuses a week that started less than an hour ago (a double click)', () => {
    const result = evaluateWeekAdvance({
      actor: ADMIN,
      guildId: GUILD,
      currentWeek: { number: 7, startedAt: new Date(NOW.getTime() - HOUR + 1) },
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('WEEK_TOO_RECENT')
  })

  it('allows it exactly one hour in', () => {
    const result = evaluateWeekAdvance({
      actor: ADMIN,
      guildId: GUILD,
      currentWeek: { number: 7, startedAt: new Date(NOW.getTime() - HOUR) },
      now: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a member', () => {
    const result = evaluateWeekAdvance({ actor: actor(), guildId: GUILD, currentWeek: null, now: NOW })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses an admin of another guild', () => {
    const result = evaluateWeekAdvance({ actor: ADMIN, guildId: 'other', currentWeek: null, now: NOW })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })
})

describe('excusing an absence', () => {
  const target = { id: 'user-1', guildId: GUILD }

  it('lets an admin excuse a member', () => {
    const result = evaluateExcuse({ actor: ADMIN, target, eventsExcused: 2, reason: '  Viagem  ' })
    expect(result.ok && result.value).toEqual({ eventsExcused: 2, reason: 'Viagem' })
  })

  it('refuses an admin excusing their own absence', () => {
    const result = evaluateExcuse({ actor: ADMIN, target: { id: ADMIN.id, guildId: GUILD }, eventsExcused: 1, reason: 'Viagem' })
    expect(!result.ok && result.code).toBe('SELF_EXCUSE_FORBIDDEN')
  })

  it('refuses a member excusing anybody', () => {
    const result = evaluateExcuse({ actor: actor({ id: 'user-2' }), target, eventsExcused: 1, reason: 'Viagem' })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a target in another guild', () => {
    const result = evaluateExcuse({ actor: ADMIN, target: { id: 'x', guildId: 'other' }, eventsExcused: 1, reason: 'Viagem' })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses zero, fractional and oversized amounts', () => {
    for (const eventsExcused of [0, 1.5, 51]) {
      const result = evaluateExcuse({ actor: ADMIN, target, eventsExcused, reason: 'Viagem' })
      expect(!result.ok && result.code).toBe('INVALID_AMOUNT')
    }
    expect(evaluateExcuse({ actor: ADMIN, target, eventsExcused: 50, reason: 'Viagem' }).ok).toBe(true)
  })

  it('requires a reason', () => {
    const result = evaluateExcuse({ actor: ADMIN, target, eventsExcused: 1, reason: '  ' })
    expect(!result.ok && result.code).toBe('REASON_REQUIRED')
  })
})

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

describe('penalties', () => {
  const target = { id: 'user-1', guildId: GUILD }

  it('turns the points into a negative amount', () => {
    const result = evaluatePenalty({ actor: ADMIN, target, points: 5, reason: 'Faltou na guerra' })
    expect(result.ok && result.value).toEqual({ amount: -5, reason: 'Faltou na guerra' })
  })

  it('refuses a member', () => {
    const result = evaluatePenalty({ actor: actor({ id: 'user-2' }), target, points: 5, reason: 'x x x' })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses an admin penalizing their own account', () => {
    const result = evaluatePenalty({ actor: ADMIN, target: { id: ADMIN.id, guildId: GUILD }, points: 5, reason: 'x x x' })
    expect(!result.ok && result.code).toBe('SELF_PENALTY_FORBIDDEN')
  })

  it('refuses zero, negative and fractional points', () => {
    for (const points of [0, -3, 2.5]) {
      const result = evaluatePenalty({ actor: ADMIN, target, points, reason: 'x x x' })
      expect(!result.ok && result.code).toBe('INVALID_AMOUNT')
    }
  })

  it('requires a reason', () => {
    const result = evaluatePenalty({ actor: ADMIN, target, points: 5, reason: 'no' })
    expect(!result.ok && result.code).toBe('REASON_REQUIRED')
  })
})

describe('reversing a penalty cannot mint', () => {
  const penalty = { userId: 'user-1', guildId: GUILD, kind: 'PENALTY', amount: -5, state: 'CONFIRMED' }

  it('credits exactly what the penalty took', () => {
    const result = evaluatePenaltyReversal({ actor: ADMIN, penalty, alreadyReversed: false })
    expect(result.ok && result.value.amount).toBe(5)
  })

  it('refuses a second reversal of the same penalty', () => {
    const result = evaluatePenaltyReversal({ actor: ADMIN, penalty, alreadyReversed: true })
    expect(!result.ok && result.code).toBe('ALREADY_REVERSED')
  })

  it('refuses an admin reversing a penalty on their own account', () => {
    const result = evaluatePenaltyReversal({
      actor: ADMIN,
      penalty: { ...penalty, userId: ADMIN.id },
      alreadyReversed: false,
    })
    expect(!result.ok && result.code).toBe('SELF_PENALTY_FORBIDDEN')
  })

  it('refuses to "reverse" a row that is not a penalty', () => {
    for (const row of [
      { ...penalty, kind: 'EVENT_AWARD', amount: 100 },
      { ...penalty, kind: 'LOOT_HOLD' },
      { ...penalty, amount: 5 },
      { ...penalty, state: 'REVERSED' },
    ]) {
      const result = evaluatePenaltyReversal({ actor: ADMIN, penalty: row, alreadyReversed: false })
      expect(!result.ok && result.code).toBe('NOT_FOUND')
    }
  })

  it('refuses a member', () => {
    const result = evaluatePenaltyReversal({ actor: actor({ id: 'user-2' }), penalty, alreadyReversed: false })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// Combat power tiers
// ---------------------------------------------------------------------------

describe('combat power tiers', () => {
  it('is Mega exactly at the Mega threshold', () => {
    expect(classifyCombatPower(190_000, THRESHOLDS)).toBe('MEGA')
    expect(classifyCombatPower(189_999, THRESHOLDS)).toBe('TITAN')
  })

  it('is Titan exactly at the Titan threshold', () => {
    expect(classifyCombatPower(155_000, THRESHOLDS)).toBe('TITAN')
    expect(classifyCombatPower(154_999, THRESHOLDS)).toBe('NONE')
  })

  it('switches a tier off when its threshold is 0', () => {
    expect(classifyCombatPower(999_999, { megaCpThreshold: 0, titanCpThreshold: 0 })).toBe('NONE')
  })

  it('lets Megas into Titan items, but not Titans into Mega items', () => {
    expect(meetsLootRestriction('MEGA', 'TITAN')).toBe(true)
    expect(meetsLootRestriction('TITAN', 'MEGA')).toBe(false)
    expect(meetsLootRestriction('NONE', 'TITAN')).toBe(false)
    expect(meetsLootRestriction('NONE', 'ALL')).toBe(true)
  })

  it('lets an admin set the rulers', () => {
    const result = evaluateThresholdUpdate({ actor: ADMIN, guildId: GUILD, megaCpThreshold: 200_000, titanCpThreshold: 160_000 })
    expect(result.ok).toBe(true)
  })

  it('refuses a Titan ruler above the Mega ruler', () => {
    const result = evaluateThresholdUpdate({ actor: ADMIN, guildId: GUILD, megaCpThreshold: 100, titanCpThreshold: 200 })
    expect(!result.ok && result.code).toBe('INVALID_THRESHOLD')
  })

  it('refuses negative and fractional rulers', () => {
    for (const value of [-1, 1.5, MAX_COMBAT_POWER + 1]) {
      const result = evaluateThresholdUpdate({ actor: ADMIN, guildId: GUILD, megaCpThreshold: value, titanCpThreshold: 0 })
      expect(!result.ok && result.code).toBe('INVALID_THRESHOLD')
    }
  })

  it('refuses a member', () => {
    const result = evaluateThresholdUpdate({ actor: actor(), guildId: GUILD, megaCpThreshold: 1, titanCpThreshold: 1 })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// Editing a character (stats and build)
// ---------------------------------------------------------------------------

describe('editing a character', () => {
  const input = { name: 'Nova', biosuit: 'Technician', level: 71, combatPower: 210_000, build: { ...NO_BUILD, skill4: true } }

  it('lets the owner change level, combat power, class and build', () => {
    const result = evaluateCharacterStatsUpdate({ actor: actor(), restrictions: [], character: main(), input, now: NOW })
    expect(result.ok && result.value).toMatchObject({ level: 71, combatPower: 210_000, biosuit: 'Technician', viaAdmin: false })
    expect(result.ok && result.value.build.skill4).toBe(true)
  })

  it('refuses the owner renaming their character', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: actor(),
      restrictions: [],
      character: main(),
      input: { ...input, name: 'Impostor' },
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('NAME_CHANGE_ADMIN_ONLY')
  })

  it('treats surrounding whitespace in an unchanged name as unchanged', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: actor(),
      restrictions: [],
      character: main(),
      input: { ...input, name: '  Nova ' },
      now: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('lets an admin edit, and rename, another member character', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: ADMIN,
      restrictions: [],
      character: main(),
      input: { ...input, name: 'Nova Prime' },
      now: NOW,
    })
    expect(result.ok && result.value).toMatchObject({ name: 'Nova Prime', viaAdmin: true })
  })

  it('refuses a member editing another member character', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: actor({ id: 'user-2' }),
      restrictions: [],
      character: main(),
      input,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses an admin of another guild', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: actor({ id: 'admin-x', role: 'LEADER', guildId: 'other' }),
      restrictions: [],
      character: main(),
      input,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a retired character', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: actor(),
      restrictions: [],
      character: main({ isActive: false }),
      input,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('CHARACTER_INACTIVE')
  })

  it('refuses a banned account', () => {
    const result = evaluateCharacterStatsUpdate({ actor: actor(), restrictions: [live('BAN')], character: main(), input, now: NOW })
    expect(!result.ok && result.code).toBe('ACCOUNT_BANNED')
  })

  it('refuses negative, fractional and absurd combat power', () => {
    for (const combatPower of [-1, 1.5, MAX_COMBAT_POWER + 1]) {
      const result = evaluateCharacterStatsUpdate({
        actor: actor(),
        restrictions: [],
        character: main(),
        input: { ...input, combatPower },
        now: NOW,
      })
      expect(!result.ok && result.code).toBe('INVALID_COMBAT_POWER')
    }
  })

  it('applies the same level bounds as creation', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: actor(),
      restrictions: [],
      character: main(),
      input: { ...input, level: 1000 },
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVALID_LEVEL')
  })

  it('coerces anything but true in the build to false', () => {
    const result = evaluateCharacterStatsUpdate({
      actor: actor(),
      restrictions: [],
      character: main(),
      input: { ...input, build: { ...NO_BUILD, trinity: 'yes' as unknown as boolean } },
      now: NOW,
    })
    expect(result.ok && result.value.build.trinity).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Loot banner
// ---------------------------------------------------------------------------

describe('publishing a loot banner', () => {
  const items = [{ name: 'Espada Lendária', maxPoints: 100, restriction: 'ALL' as const }]

  it('computes the deadline from the chosen duration', () => {
    const result = evaluateLootBannerCreate({ actor: ADMIN, guildId: GUILD, title: 'Sorteio', durationHours: 24, items, hasOpenBanner: false, now: NOW })
    expect(result.ok && result.value.closesAt?.getTime()).toBe(NOW.getTime() + 24 * HOUR)
  })

  it('allows a banner with no deadline', () => {
    const result = evaluateLootBannerCreate({ actor: ADMIN, guildId: GUILD, title: 'Sorteio', durationHours: null, items, hasOpenBanner: false, now: NOW })
    expect(result.ok && result.value.closesAt).toBeNull()
  })

  it('refuses a second open banner', () => {
    const result = evaluateLootBannerCreate({ actor: ADMIN, guildId: GUILD, title: 'Sorteio', durationHours: 24, items, hasOpenBanner: true, now: NOW })
    expect(!result.ok && result.code).toBe('BANNER_ALREADY_OPEN')
  })

  it('refuses a member', () => {
    const result = evaluateLootBannerCreate({ actor: actor(), guildId: GUILD, title: 'Sorteio', durationHours: 24, items, hasOpenBanner: false, now: NOW })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses no items and too many items', () => {
    const none = evaluateLootBannerCreate({ actor: ADMIN, guildId: GUILD, title: 'Sorteio', durationHours: 24, items: [], hasOpenBanner: false, now: NOW })
    expect(!none.ok && none.code).toBe('INVALID_ITEMS')
    const many = Array.from({ length: LOOT_MAX_ITEMS_PER_BANNER + 1 }, (_, i) => ({ ...items[0]!, name: `Item ${i}` }))
    const tooMany = evaluateLootBannerCreate({ actor: ADMIN, guildId: GUILD, title: 'Sorteio', durationHours: 24, items: many, hasOpenBanner: false, now: NOW })
    expect(!tooMany.ok && tooMany.code).toBe('INVALID_ITEMS')
  })

  it('refuses an item cap of zero', () => {
    const result = evaluateLootBannerCreate({
      actor: ADMIN,
      guildId: GUILD,
      title: 'Sorteio',
      durationHours: 24,
      items: [{ ...items[0]!, maxPoints: 0 }],
      hasOpenBanner: false,
      now: NOW,
    })
    expect(!result.ok && result.code).toBe('INVALID_AMOUNT')
  })

  it('refuses a blank title and a blank item name', () => {
    const title = evaluateLootBannerCreate({ actor: ADMIN, guildId: GUILD, title: ' ', durationHours: 24, items, hasOpenBanner: false, now: NOW })
    expect(!title.ok && title.code).toBe('INVALID_TITLE')
    const name = evaluateLootBannerCreate({
      actor: ADMIN,
      guildId: GUILD,
      title: 'Sorteio',
      durationHours: 24,
      items: [{ ...items[0]!, name: 'x' }],
      hasOpenBanner: false,
      now: NOW,
    })
    expect(!name.ok && name.code).toBe('INVALID_ITEM_NAME')
  })

  it('refuses a zero-hour deadline', () => {
    const result = evaluateLootBannerCreate({ actor: ADMIN, guildId: GUILD, title: 'Sorteio', durationHours: 0, items, hasOpenBanner: false, now: NOW })
    expect(!result.ok && result.code).toBe('INVALID_TTL')
  })
})

describe('the loot banner deadline', () => {
  it('stops taking bets the instant the deadline arrives', () => {
    expect(isBannerAcceptingBets(banner({ closesAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(true)
    expect(isBannerAcceptingBets(banner({ closesAt: NOW }), NOW)).toBe(false)
  })

  it('takes bets forever when there is no deadline', () => {
    expect(isBannerAcceptingBets(banner({ closesAt: null }), NOW)).toBe(true)
  })

  it('takes no bets once closed', () => {
    expect(isBannerAcceptingBets(banner({ status: 'CLOSED', closesAt: null }), NOW)).toBe(false)
  })

  it('extends from the deadline when it is still ahead', () => {
    const result = evaluateBannerExtend({ actor: ADMIN, banner: banner(), hours: 2, now: NOW })
    expect(result.ok && result.value.closesAt.getTime()).toBe(NOW.getTime() + 3 * HOUR)
  })

  it('extends from now when the deadline already passed', () => {
    const result = evaluateBannerExtend({
      actor: ADMIN,
      banner: banner({ closesAt: new Date(NOW.getTime() - 5 * HOUR) }),
      hours: 2,
      now: NOW,
    })
    expect(result.ok && result.value.closesAt.getTime()).toBe(NOW.getTime() + 2 * HOUR)
  })

  it('refuses extending a banner with no deadline, a closed one, or by a member', () => {
    const noDeadline = evaluateBannerExtend({ actor: ADMIN, banner: banner({ closesAt: null }), hours: 1, now: NOW })
    expect(!noDeadline.ok && noDeadline.code).toBe('NO_DEADLINE')
    const closed = evaluateBannerExtend({ actor: ADMIN, banner: banner({ status: 'CLOSED' }), hours: 1, now: NOW })
    expect(!closed.ok && closed.code).toBe('LOOT_CLOSED')
    const member = evaluateBannerExtend({ actor: actor(), banner: banner(), hours: 1, now: NOW })
    expect(!member.ok && member.code).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// Loot bets
// ---------------------------------------------------------------------------

describe('placing a loot bet', () => {
  it('accepts a valid bet', () => {
    const result = evaluateLootBet(betParams())
    expect(result.ok && result.value.points).toBe(10)
  })

  it('refuses a bet one point above the spendable balance', () => {
    const result = evaluateLootBet(betParams({ points: 51 }))
    expect(!result.ok && result.code).toBe('INSUFFICIENT_POINTS')
    expect(evaluateLootBet(betParams({ points: 50 })).ok).toBe(true)
  })

  it('refuses a bet one point above the item cap', () => {
    const result = evaluateLootBet(betParams({ points: 101, availablePoints: 500 }))
    expect(!result.ok && result.code).toBe('BET_ABOVE_MAX')
    expect(evaluateLootBet(betParams({ points: 100, availablePoints: 500 })).ok).toBe(true)
  })

  it('refuses participation just under the minimum and accepts it exactly at it', () => {
    const under = evaluateLootBet(betParams({ participationPct: 89.9 }))
    expect(!under.ok && under.code).toBe('PARTICIPATION_TOO_LOW')
    expect(evaluateLootBet(betParams({ participationPct: 90 })).ok).toBe(true)
  })

  it('refuses an ALT: points are spent by the account main', () => {
    const result = evaluateLootBet(betParams({ character: main({ kind: 'ALT', mainCharacterId: 'char-0' }) }))
    expect(!result.ok && result.code).toBe('MAIN_CHARACTER_REQUIRED')
  })

  it('refuses betting with someone else character', () => {
    const result = evaluateLootBet(betParams({ character: main({ userId: 'user-2' }) }))
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses an item from another guild or another banner', () => {
    const guild = evaluateLootBet(betParams({ item: item({ guildId: 'other' }) }))
    expect(!guild.ok && guild.code).toBe('FORBIDDEN')
    const other = evaluateLootBet(betParams({ item: item({ bannerId: 'banner-2' }) }))
    expect(!other.ok && other.code).toBe('FORBIDDEN')
  })

  it('refuses a second bet on the same item', () => {
    const result = evaluateLootBet(betParams({ hasActiveBet: true }))
    expect(!result.ok && result.code).toBe('ALREADY_BET')
  })

  it('refuses after the deadline and on a drawn item', () => {
    const late = evaluateLootBet(betParams({ banner: banner({ closesAt: NOW }) }))
    expect(!late.ok && late.code).toBe('LOOT_CLOSED')
    const drawn = evaluateLootBet(betParams({ item: item({ status: 'DRAWN' }) }))
    expect(!drawn.ok && drawn.code).toBe('ITEM_NOT_OPEN')
  })

  it('enforces the Titan and Mega restrictions', () => {
    const titanOnly = item({ restriction: 'TITAN' })
    const weak = evaluateLootBet(betParams({ item: titanOnly, character: main({ combatPower: 154_999 }) }))
    expect(!weak.ok && weak.code).toBe('TIER_REQUIRED')
    expect(evaluateLootBet(betParams({ item: titanOnly, character: main({ combatPower: 155_000 }) })).ok).toBe(true)

    const megaOnly = item({ restriction: 'MEGA' })
    const titan = evaluateLootBet(betParams({ item: megaOnly, character: main({ combatPower: 189_999 }) }))
    expect(!titan.ok && titan.code).toBe('TIER_REQUIRED')
  })

  it('refuses zero, negative and fractional bets', () => {
    for (const points of [0, -5, 2.5]) {
      const result = evaluateLootBet(betParams({ points }))
      expect(!result.ok && result.code).toBe('INVALID_AMOUNT')
    }
  })

  it('refuses a member barred from loot, and a banned one', () => {
    const barred = evaluateLootBet(betParams({ restrictions: [live('NO_LOOT')] }))
    expect(!barred.ok && barred.code).toBe('RESTRICTED')
    const banned = evaluateLootBet(betParams({ restrictions: [live('BAN')] }))
    expect(!banned.ok && banned.code).toBe('ACCOUNT_BANNED')
  })

  it('refuses a retired main', () => {
    const result = evaluateLootBet(betParams({ character: main({ isActive: false }) }))
    expect(!result.ok && result.code).toBe('CHARACTER_INACTIVE')
  })
})

describe('withdrawing a loot bet', () => {
  const bet = { userId: 'user-1', guildId: GUILD, status: 'ACTIVE' as const }

  it('lets the owner withdraw while bets are open', () => {
    const result = evaluateBetWithdrawal({ actor: actor(), bet, item: item(), banner: banner(), now: NOW })
    expect(result.ok && result.value.viaAdmin).toBe(false)
  })

  it('locks the owner out once the deadline passed', () => {
    const result = evaluateBetWithdrawal({ actor: actor(), bet, item: item(), banner: banner({ closesAt: NOW }), now: NOW })
    expect(!result.ok && result.code).toBe('LOOT_CLOSED')
  })

  it('still lets an admin withdraw after the deadline, until the draw', () => {
    const result = evaluateBetWithdrawal({ actor: ADMIN, bet, item: item(), banner: banner({ closesAt: NOW }), now: NOW })
    expect(result.ok && result.value.viaAdmin).toBe(true)
  })

  it('refuses another member', () => {
    const result = evaluateBetWithdrawal({ actor: actor({ id: 'user-2' }), bet, item: item(), banner: banner(), now: NOW })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a settled bet or a drawn item', () => {
    const released = evaluateBetWithdrawal({ actor: actor(), bet: { ...bet, status: 'RELEASED' }, item: item(), banner: banner(), now: NOW })
    expect(!released.ok && released.code).toBe('BET_SETTLED')
    const drawn = evaluateBetWithdrawal({ actor: ADMIN, bet, item: item({ status: 'DRAWN' }), banner: banner(), now: NOW })
    expect(!drawn.ok && drawn.code).toBe('BET_SETTLED')
  })
})

// ---------------------------------------------------------------------------
// The wheel
// ---------------------------------------------------------------------------

describe('the loot wheel', () => {
  const bets = [
    { id: 'a', label: 'A', points: 1 },
    { id: 'b', label: 'B', points: 9 },
  ]

  it('reserves the staff share and splits the rest by points', () => {
    const wheel = buildLootWheel({ bets, staffLabel: 'Staff', staffSharePct: 15 })
    const byId = new Map(wheel.map((s) => [s.betId ?? 'staff', s.weight]))
    expect(byId.get('staff')).toBeCloseTo(0.15)
    expect(byId.get('a')).toBeCloseTo(0.085)
    expect(byId.get('b')).toBeCloseTo(0.765)
  })

  it('gives one point on a 10-point table 8.5%, as the tutorial promises', () => {
    const wheel = buildLootWheel({ bets, staffLabel: 'Staff', staffSharePct: 15 })
    expect(wheel.find((s) => s.betId === 'a')?.weight).toBeCloseTo(0.085)
  })

  it('always sums to exactly one', () => {
    const wheel = buildLootWheel({
      bets: [
        { id: 'a', label: 'A', points: 3 },
        { id: 'b', label: 'B', points: 7 },
        { id: 'c', label: 'C', points: 11 },
      ],
      staffLabel: 'Staff',
      staffSharePct: 15,
    })
    expect(wheel.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1)
  })

  it('gives the bettors everything when no staff is picked', () => {
    const wheel = buildLootWheel({ bets, staffLabel: null, staffSharePct: 15 })
    expect(wheel.some((s) => s.kind === 'STAFF')).toBe(false)
    expect(wheel.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1)
  })

  it('is empty with no bets, and ignores non-positive bets', () => {
    expect(buildLootWheel({ bets: [], staffLabel: 'Staff', staffSharePct: 15 })).toEqual([])
    expect(buildLootWheel({ bets: [{ id: 'z', label: 'Z', points: 0 }], staffLabel: 'Staff', staffSharePct: 15 })).toEqual([])
  })

  it('picks the slice the roll lands on, including both edges', () => {
    const wheel = buildLootWheel({ bets, staffLabel: 'Staff', staffSharePct: 15 })
    expect(pickWheelSlice(wheel, 0)?.betId).toBe('a')
    expect(pickWheelSlice(wheel, 0.0849)?.betId).toBe('a')
    expect(pickWheelSlice(wheel, 0.0851)?.betId).toBe('b')
    expect(pickWheelSlice(wheel, 0.9999)?.kind).toBe('STAFF')
    expect(pickWheelSlice(wheel, 1)?.kind).toBe('STAFF')
    expect(pickWheelSlice([], 0.5)).toBeNull()
  })
})

describe('running a loot draw', () => {
  const bets = [{ userId: 'user-1' }]

  it('lets an admin draw an item with bets', () => {
    expect(evaluateLootDraw({ actor: ADMIN, item: item(), bets, staff: { id: VICE.id, guildId: GUILD, role: 'VICE_LEADER' } }).ok).toBe(true)
  })

  it('refuses an admin drawing an item they bet on', () => {
    const result = evaluateLootDraw({ actor: ADMIN, item: item(), bets: [{ userId: ADMIN.id }], staff: null })
    expect(!result.ok && result.code).toBe('SELF_DRAW_FORBIDDEN')
  })

  it('refuses an item with no bets and an item already drawn', () => {
    const none = evaluateLootDraw({ actor: ADMIN, item: item(), bets: [], staff: null })
    expect(!none.ok && none.code).toBe('NO_BETS')
    const drawn = evaluateLootDraw({ actor: ADMIN, item: item({ status: 'DRAWN' }), bets, staff: null })
    expect(!drawn.ok && drawn.code).toBe('ITEM_NOT_OPEN')
  })

  it('refuses a staff slice that belongs to a plain member or another guild', () => {
    const member = evaluateLootDraw({ actor: ADMIN, item: item(), bets, staff: { id: 'm', guildId: GUILD, role: 'MEMBER' } })
    expect(!member.ok && member.code).toBe('INVALID_STAFF')
    const foreign = evaluateLootDraw({ actor: ADMIN, item: item(), bets, staff: { id: 'x', guildId: 'other', role: 'LEADER' } })
    expect(!foreign.ok && foreign.code).toBe('INVALID_STAFF')
  })

  it('refuses a member', () => {
    const result = evaluateLootDraw({ actor: actor({ id: 'user-2' }), item: item(), bets, staff: null })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// Meme raffle
// ---------------------------------------------------------------------------

describe('the meme raffle', () => {
  const candidates = [
    { id: 'c1', guildId: GUILD, isActive: true },
    { id: 'c2', guildId: GUILD, isActive: true },
  ]

  it('lets an admin draw among active members of the guild', () => {
    const result = evaluateMemeDraw({ actor: ADMIN, guildId: GUILD, itemName: 'Chapéu de Pato', candidates, requestedCount: 2 })
    expect(result.ok && result.value.itemName).toBe('Chapéu de Pato')
  })

  it('refuses when a requested candidate did not load (unknown or foreign id)', () => {
    const result = evaluateMemeDraw({ actor: ADMIN, guildId: GUILD, itemName: 'Chapéu', candidates, requestedCount: 3 })
    expect(!result.ok && result.code).toBe('INVALID_CANDIDATES')
  })

  it('refuses a candidate from another guild or a retired one', () => {
    const foreign = evaluateMemeDraw({
      actor: ADMIN,
      guildId: GUILD,
      itemName: 'Chapéu',
      candidates: [...candidates, { id: 'x', guildId: 'other', isActive: true }],
      requestedCount: 3,
    })
    expect(!foreign.ok && foreign.code).toBe('INVALID_CANDIDATES')
    const retired = evaluateMemeDraw({
      actor: ADMIN,
      guildId: GUILD,
      itemName: 'Chapéu',
      candidates: [{ id: 'r', guildId: GUILD, isActive: false }],
      requestedCount: 1,
    })
    expect(!retired.ok && retired.code).toBe('INVALID_CANDIDATES')
  })

  it('refuses an empty draw and a member', () => {
    const empty = evaluateMemeDraw({ actor: ADMIN, guildId: GUILD, itemName: 'Chapéu', candidates: [], requestedCount: 0 })
    expect(!empty.ok && empty.code).toBe('INVALID_CANDIDATES')
    const member = evaluateMemeDraw({ actor: actor(), guildId: GUILD, itemName: 'Chapéu', candidates, requestedCount: 2 })
    expect(!member.ok && member.code).toBe('FORBIDDEN')
  })

  it('picks every index uniformly, edges included', () => {
    expect(pickUniformIndex(4, 0)).toBe(0)
    expect(pickUniformIndex(4, 0.2499)).toBe(0)
    expect(pickUniformIndex(4, 0.25)).toBe(1)
    expect(pickUniformIndex(4, 0.9999)).toBe(3)
    expect(pickUniformIndex(4, 1)).toBe(3)
    expect(pickUniformIndex(0, 0.5)).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// Boss schedule
// ---------------------------------------------------------------------------

describe('boss spawn times', () => {
  function schedule(overrides: Partial<BossSchedule>): BossSchedule {
    return { respawnKind: 'DAILY', intervalHours: null, anchorAt: null, dailyTimes: null, weekdays: null, ...overrides }
  }

  it('returns a future interval anchor as-is', () => {
    const anchor = new Date(NOW.getTime() + 2 * HOUR)
    expect(nextSpawn(schedule({ respawnKind: 'INTERVAL', intervalHours: 42, anchorAt: anchor }), NOW)).toEqual(anchor)
  })

  it('rolls a past interval anchor forward by whole cycles', () => {
    const anchor = new Date(NOW.getTime() - 50 * HOUR)
    const next = nextSpawn(schedule({ respawnKind: 'INTERVAL', intervalHours: 42, anchorAt: anchor }), NOW)
    expect(next?.getTime()).toBe(anchor.getTime() + 84 * HOUR)
  })

  it('treats a boss spawning exactly now as a full cycle away', () => {
    const next = nextSpawn(schedule({ respawnKind: 'INTERVAL', intervalHours: 42, anchorAt: NOW }), NOW)
    expect(next?.getTime()).toBe(NOW.getTime() + 42 * HOUR)
  })

  it('picks today at a later BRT time', () => {
    // 12:00 BRT now; 16:00 BRT today is 19:00 UTC.
    const next = nextSpawn(schedule({ dailyTimes: '16:00, 22:30' }), NOW)
    expect(next?.toISOString()).toBe('2026-09-19T19:00:00.000Z')
  })

  it('rolls to tomorrow once every time today has passed', () => {
    const next = nextSpawn(schedule({ dailyTimes: '10:00' }), NOW)
    expect(next?.toISOString()).toBe('2026-09-20T13:00:00.000Z')
  })

  it('treats a daily time exactly now as tomorrow', () => {
    const next = nextSpawn(schedule({ dailyTimes: '12:00' }), NOW)
    expect(next?.toISOString()).toBe('2026-09-20T15:00:00.000Z')
  })

  it('uses the BRT date, not the UTC date, late at night', () => {
    // 23:30 BRT on Saturday is already Sunday in UTC.
    const lateNight = new Date('2026-09-20T02:30:00.000Z')
    const next = nextSpawn(schedule({ dailyTimes: '23:45' }), lateNight)
    expect(next?.toISOString()).toBe('2026-09-20T02:45:00.000Z')
  })

  it('finds the next listed weekday', () => {
    // Saturday now; Monday (1) 20:00 BRT.
    const next = nextSpawn(schedule({ respawnKind: 'WEEKLY', dailyTimes: '20:00', weekdays: '1' }), NOW)
    expect(next?.toISOString()).toBe('2026-09-21T23:00:00.000Z')
  })

  it('uses a later time today when today is a listed weekday', () => {
    const next = nextSpawn(schedule({ respawnKind: 'WEEKLY', dailyTimes: '20:00', weekdays: '6' }), NOW)
    expect(next?.toISOString()).toBe('2026-09-19T23:00:00.000Z')
  })

  it('wraps a whole week when today is the only day and its time has passed', () => {
    const next = nextSpawn(schedule({ respawnKind: 'WEEKLY', dailyTimes: '08:00', weekdays: '6' }), NOW)
    expect(next?.toISOString()).toBe('2026-09-26T11:00:00.000Z')
  })

  it('returns null for a schedule it cannot read', () => {
    expect(nextSpawn(schedule({ dailyTimes: 'noon' }), NOW)).toBeNull()
    expect(nextSpawn(schedule({ respawnKind: 'INTERVAL', intervalHours: 42, anchorAt: null }), NOW)).toBeNull()
  })
})

describe('boss schedule input', () => {
  it('parses and normalises spawn times', () => {
    expect(parseDailyTimes('16:00, 9:05')).toEqual([
      { hour: 16, minute: 0 },
      { hour: 9, minute: 5 },
    ])
    expect(parseDailyTimes('24:00')).toBeNull()
    expect(parseDailyTimes('12:60')).toBeNull()
    expect(parseDailyTimes('')).toBeNull()
  })

  it('parses weekdays, deduplicated and sorted', () => {
    expect(parseWeekdays('5, 1,1')).toEqual([1, 5])
    expect(parseWeekdays('7')).toBeNull()
    expect(parseWeekdays('')).toBeNull()
  })

  it('drops the fields a kind does not use', () => {
    const result = validateBossSchedule({
      respawnKind: 'DAILY',
      intervalHours: 42,
      anchorAt: NOW,
      dailyTimes: '9:00,16:00',
      weekdays: '1',
    })
    expect(result.ok && result.value).toEqual({
      respawnKind: 'DAILY',
      intervalHours: null,
      anchorAt: null,
      dailyTimes: '09:00, 16:00',
      weekdays: null,
    })
  })

  it('refuses an interval without an anchor or with a zero interval', () => {
    const noAnchor = validateBossSchedule({ respawnKind: 'INTERVAL', intervalHours: 42, anchorAt: null, dailyTimes: null, weekdays: null })
    expect(!noAnchor.ok && noAnchor.code).toBe('INVALID_SCHEDULE')
    const zero = validateBossSchedule({ respawnKind: 'INTERVAL', intervalHours: 0, anchorAt: NOW, dailyTimes: null, weekdays: null })
    expect(!zero.ok && zero.code).toBe('INVALID_SCHEDULE')
  })

  it('refuses a weekly schedule with no weekday', () => {
    const result = validateBossSchedule({ respawnKind: 'WEEKLY', intervalHours: null, anchorAt: null, dailyTimes: '20:00', weekdays: null })
    expect(!result.ok && result.code).toBe('INVALID_SCHEDULE')
  })

  it('lets a group schedule win over the boss own fields', () => {
    const group: BossSchedule = { respawnKind: 'DAILY', intervalHours: null, anchorAt: null, dailyTimes: '16:00', weekdays: null }
    const boss = { respawnKind: 'INTERVAL' as const, intervalHours: 42, anchorAt: NOW, dailyTimes: null, weekdays: null }
    expect(resolveBossSchedule(boss, group)).toBe(group)
    expect(resolveBossSchedule(boss, null)?.respawnKind).toBe('INTERVAL')
    expect(resolveBossSchedule({ ...boss, respawnKind: null }, null)).toBeNull()
  })

  it('names the BRT day of an instant', () => {
    expect(brtDay(new Date('2026-09-20T02:30:00.000Z'))).toEqual({ key: '2026-09-19', weekday: 6, day: 19, month: 9 })
  })
})
