import { describe, expect, it } from 'vitest'
import {
  deriveUserStatus,
  evaluateAccountAccess,
  evaluateApproval,
  evaluateGuildCreate,
  evaluateMemberInviteIssue,
  slugify,
  type Actor,
  type RestrictionLike,
} from '@/lib/rules'

/**
 * Sign-up is open and the board is public, so these are the rules that decide
 * who actually gets in and who may add another guild to the deployment.
 */

const NOW = new Date('2026-09-19T15:00:00.000Z')
const GUILD = '11111111-1111-1111-1111-111111111111'
const OTHER_GUILD = '22222222-2222-2222-2222-222222222222'

function actor(overrides: Partial<Actor> = {}): Actor {
  return { id: 'user-1', guildId: GUILD, role: 'MEMBER', status: 'ACTIVE', isActive: true, ...overrides }
}

const LEADER = actor({ id: 'leader-1', role: 'LEADER' })
const VICE = actor({ id: 'vice-1', role: 'VICE_LEADER' })
const SUPER = actor({ id: 'super-1', role: 'SUPER_ADMIN' })

const NONE: RestrictionLike[] = []

describe('an account nobody approved has no access', () => {
  const pending = { status: 'PENDING' as const, isActive: true, deletedAt: null, approvedAt: null }

  it('refuses a sign-up that is still waiting', () => {
    const result = evaluateAccountAccess(pending, NONE, NOW)
    expect(!result.ok && result.code).toBe('ACCOUNT_PENDING_APPROVAL')
  })

  it('lets the same account in once approved', () => {
    expect(evaluateAccountAccess({ ...pending, status: 'ACTIVE', approvedAt: NOW }, NONE, NOW).ok).toBe(true)
  })

  it('leaves approval out when the caller did not ask about it', () => {
    // The session already proved the account is approved; passing `undefined`
    // is how the sign-in pre-check avoids answering "is this address real?".
    const withoutApproval = { status: 'ACTIVE' as const, isActive: true, deletedAt: null }
    expect(evaluateAccountAccess(withoutApproval, NONE, NOW).ok).toBe(true)
  })

  it('reports a deleted account before a pending one', () => {
    const result = evaluateAccountAccess({ ...pending, deletedAt: NOW }, NONE, NOW)
    expect(!result.ok && result.code).toBe('ACCOUNT_DELETED')
  })

  it('derives the PENDING status from the missing approval', () => {
    expect(deriveUserStatus(pending, NONE, NOW)).toBe('PENDING')
    expect(deriveUserStatus({ ...pending, approvedAt: NOW }, NONE, NOW)).toBe('ACTIVE')
    expect(deriveUserStatus({ ...pending, deletedAt: NOW }, NONE, NOW)).toBe('DELETED')
  })
})

describe('approving a sign-up', () => {
  const target = { id: 'newcomer', guildId: GUILD, approvedAt: null, deletedAt: null }

  it('lets a leader approve', () => {
    expect(evaluateApproval({ actor: LEADER, target }).ok).toBe(true)
  })

  it('lets the super admin approve', () => {
    expect(evaluateApproval({ actor: SUPER, target }).ok).toBe(true)
  })

  it('refuses a vice-leader: who is in the guild is the leader decision', () => {
    const result = evaluateApproval({ actor: VICE, target })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses a plain member', () => {
    const result = evaluateApproval({ actor: actor(), target })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses an admin from another guild', () => {
    const result = evaluateApproval({ actor: LEADER, target: { ...target, guildId: OTHER_GUILD } })
    expect(!result.ok && result.code).toBe('FORBIDDEN')
  })

  it('refuses approving your own account', () => {
    const result = evaluateApproval({ actor: LEADER, target: { ...target, id: LEADER.id } })
    expect(!result.ok && result.code).toBe('SELF_APPROVAL_FORBIDDEN')
  })

  it('refuses approving twice', () => {
    const result = evaluateApproval({ actor: LEADER, target: { ...target, approvedAt: NOW } })
    expect(!result.ok && result.code).toBe('ALREADY_APPROVED')
  })

  it('refuses a revoked account', () => {
    const result = evaluateApproval({ actor: LEADER, target: { ...target, deletedAt: NOW } })
    expect(!result.ok && result.code).toBe('ACCOUNT_DELETED')
  })
})

describe('creating another guild', () => {
  it('lets the super admin create one and derives the slug', () => {
    const result = evaluateGuildCreate({ actor: SUPER, name: '  Brazukas Império ', tag: 'BRZ' })
    expect(result.ok && result.value).toEqual({
      name: 'Brazukas Império',
      slug: 'brazukas-imperio',
      tag: 'BRZ',
    })
  })

  it('refuses a leader, a vice-leader and a member', () => {
    for (const who of [LEADER, VICE, actor()]) {
      const result = evaluateGuildCreate({ actor: who, name: 'Nova', tag: null })
      expect(!result.ok && result.code).toBe('FORBIDDEN')
    }
  })

  it('refuses an inactive super admin', () => {
    const result = evaluateGuildCreate({ actor: { ...SUPER, isActive: false }, name: 'Nova', tag: null })
    expect(!result.ok && result.code).toBe('ACCOUNT_INACTIVE')
  })

  it('refuses a name that is too short, too long, or all punctuation', () => {
    for (const name of ['N', 'x'.repeat(61), '???']) {
      const result = evaluateGuildCreate({ actor: SUPER, name, tag: null })
      expect(!result.ok && result.code).toBe('INVALID_GUILD_NAME')
    }
  })

  it('refuses an oversized tag and keeps an empty one null', () => {
    const long = evaluateGuildCreate({ actor: SUPER, name: 'Nova', tag: 'ABCDEFGHI' })
    expect(!long.ok && long.code).toBe('INVALID_GUILD_TAG')
    const blank = evaluateGuildCreate({ actor: SUPER, name: 'Nova', tag: '  ' })
    expect(blank.ok && blank.value.tag).toBeNull()
  })

  it('slugifies accents, spaces and punctuation', () => {
    expect(slugify('Brazukas Império')).toBe('brazukas-imperio')
    expect(slugify('  Nação   do Sul!! ')).toBe('nacao-do-sul')
  })
})

describe('the leader link that comes with a new guild', () => {
  const base = { guildId: OTHER_GUILD, maxUses: 1, ttlHours: 720, now: NOW }

  it('lets the super admin issue one for a guild they do not belong to', () => {
    const result = evaluateMemberInviteIssue({ ...base, actor: SUPER, grantsRole: 'LEADER' })
    expect(result.ok && result.value.grantsRole).toBe('LEADER')
  })

  it('refuses a leader and a vice-leader', () => {
    for (const who of [LEADER, VICE]) {
      const result = evaluateMemberInviteIssue({ ...base, actor: who, grantsRole: 'LEADER' })
      expect(!result.ok && result.code).toBe('FORBIDDEN')
    }
  })

  it('refuses a leader link with more than one seat', () => {
    const result = evaluateMemberInviteIssue({ ...base, actor: SUPER, maxUses: 5, grantsRole: 'LEADER' })
    expect(!result.ok && result.code).toBe('INVALID_USES')
  })

  it('still scopes a plain recruitment link to the issuer own guild', () => {
    const foreign = evaluateMemberInviteIssue({ ...base, actor: LEADER })
    expect(!foreign.ok && foreign.code).toBe('FORBIDDEN')

    const own = evaluateMemberInviteIssue({ ...base, guildId: GUILD, actor: LEADER, maxUses: 5 })
    expect(own.ok && own.value.grantsRole).toBe('MEMBER')
  })

  it('refuses an inactive super admin', () => {
    const result = evaluateMemberInviteIssue({
      ...base,
      actor: { ...SUPER, status: 'INACTIVE' },
      grantsRole: 'LEADER',
    })
    expect(!result.ok && result.code).toBe('ACCOUNT_INACTIVE')
  })
})
