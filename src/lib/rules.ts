/**
 * Pure domain rules.
 *
 * Every invariant that protects the point economy lives here as a side-effect
 * free function, so it can be tested exhaustively without a database and reused
 * identically by server actions, the cron sweep and the admin portal. The
 * persistence layer is allowed to call these; it is not allowed to re-implement
 * them.
 */

import type {
  CharacterKind,
  Race,
  RestrictionType,
  UserRole,
  UserStatus,
} from '@/db/schema'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type RuleFailure = { ok: false; code: string; message: string }
export type RuleSuccess<T> = { ok: true; value: T }
export type RuleResult<T = undefined> = RuleSuccess<T> | RuleFailure

export function deny(code: string, message: string): RuleFailure {
  return { ok: false, code, message }
}

export function allow<T>(value: T): RuleSuccess<T> {
  return { ok: true, value }
}

// ---------------------------------------------------------------------------
// Roles & object-level authorization
// ---------------------------------------------------------------------------

const ADMIN_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'VICE_LEADER',
  'LEADER',
  'SUPER_ADMIN',
])

/** Leader, vice-leader and super admin are the roles that manage the guild. */
export function isGuildAdmin(role: UserRole): boolean {
  return ADMIN_ROLES.has(role)
}

export type Actor = {
  id: string
  guildId: string
  role: UserRole
  status: UserStatus
  isActive: boolean
}

/**
 * The object-level authorization gate (OWASP BOLA/IDOR).
 *
 * A role check alone is never enough: every read or mutation of a row that
 * belongs to somebody must also prove the caller owns that row, or is an admin
 * of the same guild. Call this in the service layer, where the entity has
 * already been loaded, before touching it.
 */
export function authorizeResource(params: {
  actor: Actor
  ownerUserId: string
  resourceGuildId: string
  /** When false, admins get no override and only the owner may proceed. */
  allowAdminOverride?: boolean
}): RuleResult<{ viaAdmin: boolean }> {
  const { actor, ownerUserId, resourceGuildId, allowAdminOverride = true } = params

  if (actor.guildId !== resourceGuildId) {
    // Same message as a plain denial: never confirm that a row exists in
    // another guild.
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  if (actor.id === ownerUserId) return allow({ viaAdmin: false })
  if (allowAdminOverride && isGuildAdmin(actor.role)) return allow({ viaAdmin: true })

  return deny('FORBIDDEN', 'You are not allowed to access this resource')
}

/** Guard for actions that are guild-wide rather than owned by one member. */
export function authorizeAdminAction(actor: Actor, guildId: string): RuleResult<undefined> {
  if (actor.guildId !== guildId) return deny('FORBIDDEN', 'Wrong guild')
  if (!isGuildAdmin(actor.role)) return deny('FORBIDDEN', 'Admin role required')
  return allow(undefined)
}

const ROLE_RANK: Record<UserRole, number> = {
  MEMBER: 0,
  VICE_LEADER: 1,
  LEADER: 2,
  SUPER_ADMIN: 3,
}

export function roleRank(role: UserRole): number {
  return ROLE_RANK[role]
}

/**
 * Moderation is only ever downward.
 *
 * An admin may act on members of strictly lower rank, never on a peer and
 * never on themselves. Without this a vice-leader could ban the leader, and
 * any admin could quietly lift their own restrictions.
 */
export function authorizeModeration(params: {
  actor: Actor
  target: { id: string; guildId: string; role: UserRole }
}): RuleResult<undefined> {
  const { actor, target } = params

  const adminCheck = authorizeAdminAction(actor, target.guildId)
  if (!adminCheck.ok) return adminCheck

  if (actor.id === target.id) {
    return deny('SELF_MODERATION_FORBIDDEN', 'You cannot apply this action to your own account')
  }
  if (roleRank(target.role) >= roleRank(actor.role)) {
    return deny('INSUFFICIENT_RANK', 'You cannot moderate a member of equal or higher rank')
  }
  return allow(undefined)
}

/**
 * Role changes carry one extra rule on top of moderation: an admin cannot
 * grant a rank at or above their own, which is what stops a vice-leader from
 * promoting an ally to leader (or to their own level) and escalating sideways.
 */
export function authorizeRoleChange(params: {
  actor: Actor
  target: { id: string; guildId: string; role: UserRole }
  newRole: UserRole
}): RuleResult<undefined> {
  const base = authorizeModeration({ actor: params.actor, target: params.target })
  if (!base.ok) return base

  if (roleRank(params.newRole) >= roleRank(params.actor.role)) {
    return deny('INSUFFICIENT_RANK', 'You cannot grant a role at or above your own')
  }
  return allow(undefined)
}

// ---------------------------------------------------------------------------
// Account state & restrictions
// ---------------------------------------------------------------------------

export type RestrictionLike = {
  type: RestrictionType
  startsAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}

/** A restriction counts only while it is started, unexpired and not revoked. */
export function isRestrictionInForce(restriction: RestrictionLike, now: Date): boolean {
  if (restriction.revokedAt !== null) return false
  if (restriction.startsAt.getTime() > now.getTime()) return false
  if (restriction.expiresAt !== null && restriction.expiresAt.getTime() <= now.getTime()) {
    return false
  }
  return true
}

export function activeRestrictionTypes(
  restrictions: readonly RestrictionLike[],
  now: Date,
): Set<RestrictionType> {
  const active = new Set<RestrictionType>()
  for (const restriction of restrictions) {
    if (isRestrictionInForce(restriction, now)) active.add(restriction.type)
  }
  return active
}

export type AccountLike = {
  status: UserStatus
  isActive: boolean
  deletedAt: Date | null
  lockedUntil?: Date | null
  /**
   * When an admin vouched for the account. `null` means nobody has yet, so it
   * has no access at all. `undefined` means "not part of this check" - the
   * callers that pass an actor already hold a session, which only an approved
   * account can have.
   */
  approvedAt?: Date | null
}

/**
 * Whether the account may sign in / act at all. Ordered from the most permanent
 * denial to the most transient so the reported reason is the accurate one.
 */
export function evaluateAccountAccess(
  account: AccountLike,
  restrictions: readonly RestrictionLike[],
  now: Date,
): RuleResult<undefined> {
  if (account.deletedAt !== null || account.status === 'DELETED') {
    return deny('ACCOUNT_DELETED', 'This account no longer has access')
  }

  // Sign-up is open, so an account nobody vouched for is not a member yet.
  if (account.approvedAt === null) {
    return deny('ACCOUNT_PENDING_APPROVAL', 'This account is waiting for an admin to approve it')
  }

  const active = activeRestrictionTypes(restrictions, now)
  if (active.has('BAN')) return deny('ACCOUNT_BANNED', 'This account is banned')
  if (active.has('SUSPENSION')) return deny('ACCOUNT_SUSPENDED', 'This account is suspended')

  // A stored BANNED status with no live restriction means the ban lapsed; the
  // sweep will reconcile the column. Do not block on a stale column alone.
  if (!account.isActive || account.status === 'INACTIVE') {
    return deny('ACCOUNT_INACTIVE', 'This account is inactive')
  }
  if (account.lockedUntil && account.lockedUntil.getTime() > now.getTime()) {
    return deny('ACCOUNT_LOCKED', 'Too many failed sign-in attempts, try again later')
  }
  return allow(undefined)
}

/** The status column the account should carry, given its live restrictions. */
export function deriveUserStatus(
  account: AccountLike,
  restrictions: readonly RestrictionLike[],
  now: Date,
): UserStatus {
  if (account.deletedAt !== null) return 'DELETED'
  if (account.approvedAt === null) return 'PENDING'
  const active = activeRestrictionTypes(restrictions, now)
  if (active.has('BAN') || active.has('SUSPENSION')) return 'BANNED'
  if (!account.isActive) return 'INACTIVE'
  return 'ACTIVE'
}

// ---------------------------------------------------------------------------
// Point balance
// ---------------------------------------------------------------------------

export type LedgerEntryLike = {
  amount: number
  state: 'PENDING' | 'CONFIRMED' | 'REVERSED'
}

export type Balance = {
  /** Earned but not spendable: the event has not reached quorum yet. */
  pending: number
  /** Spendable in auctions. Auction holds are already deducted. */
  available: number
}

/**
 * Balances are always derived from the ledger, never cached in a column, so a
 * reversal can never leave a stale total behind.
 */
export function computeBalance(entries: readonly LedgerEntryLike[]): Balance {
  let pending = 0
  let available = 0
  for (const entry of entries) {
    if (entry.state === 'PENDING') pending += entry.amount
    else if (entry.state === 'CONFIRMED') available += entry.amount
  }
  return { pending, available }
}

// ---------------------------------------------------------------------------
// Event lifecycle
// ---------------------------------------------------------------------------

export type EventStatus = 'OPEN' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'CANCELLED'

export type EventLike = {
  id: string
  guildId: string
  status: EventStatus
  pointsValue: number
  startsAt: Date
  registrationClosesAt: Date
  confirmationDeadline: Date
  minParticipants: number
  createdByUserId: string
}

export type SweepAction = 'NONE' | 'CLOSE_REGISTRATION' | 'CONFIRM' | 'CANCEL'

/**
 * Decides what the scheduled sweep must do with one event.
 *
 * - Quorum reached -> CONFIRM, and the pending points become spendable.
 * - Quorum deadline passed while short -> CANCEL, and every award is reversed.
 *   This is the anti-fraud rule the CEO asked for: an event nobody else joined
 *   cannot mint points.
 * - Join window over but the deadline has not arrived -> stop taking codes and
 *   wait.
 */
export function resolveEventSweep(params: {
  event: Pick<EventLike, 'status' | 'registrationClosesAt' | 'confirmationDeadline' | 'minParticipants'>
  registrationCount: number
  now: Date
}): SweepAction {
  const { event, registrationCount, now } = params

  if (event.status === 'CONFIRMED' || event.status === 'CANCELLED') return 'NONE'

  if (registrationCount >= event.minParticipants) return 'CONFIRM'

  if (now.getTime() >= event.confirmationDeadline.getTime()) return 'CANCEL'

  if (event.status === 'OPEN' && now.getTime() >= event.registrationClosesAt.getTime()) {
    return 'CLOSE_REGISTRATION'
  }

  return 'NONE'
}

export type CharacterLike = {
  id: string
  userId: string
  guildId: string
  kind: 'MAIN' | 'ALT'
  mainCharacterId: string | null
  level: number
  isActive: boolean
}

export type SettingsLike = {
  minParticipants: number
  confirmationWindowHours: number
  defaultCodeTtlMinutes: number
  maxCodeTtlMinutes: number
  maxRegistrationsPerDay: number
  minLevelToRegister: number
  altPointsPolicy: 'CREDIT_MAIN' | 'NO_CREDIT'
  adminGrantApprovalThreshold: number
  megaCpThreshold: number
  titanCpThreshold: number
  lootMinParticipationPct: number
  lootStaffSharePct: number
}

export type RegistrationGrant = {
  /** Account credited with the points. Always the character's own account. */
  creditUserId: string
  /** Character shown as the earner. An ALT rolls its points up to the MAIN. */
  creditCharacterId: string
  points: number
}

/**
 * Full precondition check for a player redeeming an event code.
 *
 * Returns who gets credited and how much, so the caller never has to recompute
 * the alt-rollup rule.
 */
export function evaluateRegistration(params: {
  event: EventLike
  character: CharacterLike
  actor: Actor
  settings: SettingsLike
  restrictions: readonly RestrictionLike[]
  /** Any prior registration by this ACCOUNT for this event. */
  accountAlreadyRegistered: boolean
  /** Self-code registrations by this account in the last rolling 24h. */
  registrationsLast24h: number
  now: Date
}): RuleResult<RegistrationGrant> {
  const {
    event,
    character,
    actor,
    settings,
    restrictions,
    accountAlreadyRegistered,
    registrationsLast24h,
    now,
  } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access

  const active = activeRestrictionTypes(restrictions, now)
  if (active.has('NO_EVENTS')) {
    return deny('RESTRICTED', 'You are currently barred from registering for events')
  }

  // Ownership: a player may only register their own character.
  if (character.userId !== actor.id) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  if (character.guildId !== event.guildId || actor.guildId !== event.guildId) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  if (!character.isActive) {
    return deny('CHARACTER_INACTIVE', 'This character is inactive')
  }

  if (event.status === 'CANCELLED') {
    return deny('EVENT_CANCELLED', 'This event was cancelled')
  }
  if (event.status !== 'OPEN') {
    return deny('EVENT_CLOSED', 'This event is no longer accepting registrations')
  }
  if (now.getTime() < event.startsAt.getTime()) {
    return deny('EVENT_NOT_STARTED', 'This event has not started yet')
  }
  // The code lifetime the admin picked is a hard wall.
  if (now.getTime() >= event.registrationClosesAt.getTime()) {
    return deny('CODE_EXPIRED', 'This event code has expired')
  }

  // The admin who created the event is handed the plaintext code and nobody
  // else has to have seen it. Letting them redeem it would be the same
  // self-payment `evaluateAdminGrant` refuses, through a different door - so
  // the check is on the owning account, exactly as it is there, and an alt
  // does not help.
  if (character.userId === event.createdByUserId) {
    return deny(
      'SELF_REGISTRATION_FORBIDDEN',
      'You cannot register for an event you created. Ask another admin to score you.',
    )
  }

  if (accountAlreadyRegistered) {
    return deny('ALREADY_REGISTERED', 'This account already registered for this event')
  }
  if (character.level < settings.minLevelToRegister) {
    return deny(
      'LEVEL_TOO_LOW',
      `Level ${settings.minLevelToRegister} is required to register for events`,
    )
  }
  if (registrationsLast24h >= settings.maxRegistrationsPerDay) {
    return deny('RATE_LIMITED', 'Daily registration limit reached')
  }

  const isAlt = character.kind === 'ALT'
  if (isAlt && settings.altPointsPolicy === 'NO_CREDIT') {
    return deny('ALT_NOT_ELIGIBLE', 'Only main characters can earn points in this guild')
  }

  return allow({
    creditUserId: character.userId,
    // Points always land on the account; an ALT is attributed to its MAIN so
    // the leaderboard and the auction eligibility check agree.
    creditCharacterId: isAlt ? (character.mainCharacterId ?? character.id) : character.id,
    points: event.pointsValue,
  })
}

/**
 * Manual scoring by an admin.
 *
 * Two rules make this non-abusable: an event must already exist (points cannot
 * be minted out of nothing), and an admin can never score themselves - checked
 * at the ACCOUNT level, so routing the points through an alt does not work.
 */
export function evaluateAdminGrant(params: {
  actor: Actor
  event: EventLike
  targetCharacter: CharacterLike
  targetAccount: AccountLike & { id: string; guildId: string }
  targetRestrictions: readonly RestrictionLike[]
  accountAlreadyRegistered: boolean
  settings: SettingsLike
  now: Date
}): RuleResult<RegistrationGrant & { needsSecondApproval: boolean }> {
  const {
    actor,
    event,
    targetCharacter,
    targetAccount,
    targetRestrictions,
    accountAlreadyRegistered,
    settings,
    now,
  } = params

  const adminCheck = authorizeAdminAction(actor, event.guildId)
  if (!adminCheck.ok) return adminCheck

  // "It must not be possible for an admin to promote themselves." The check is
  // on the owning ACCOUNT, which also covers granting to one's own alt.
  if (targetCharacter.userId === actor.id || targetAccount.id === actor.id) {
    return deny('SELF_GRANT_FORBIDDEN', 'An admin cannot award points to their own account')
  }

  if (event.status === 'CANCELLED') {
    return deny('EVENT_CANCELLED', 'Points cannot be granted for a cancelled event')
  }
  if (targetCharacter.guildId !== event.guildId || targetAccount.guildId !== event.guildId) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  if (!targetCharacter.isActive) {
    return deny('CHARACTER_INACTIVE', 'This character is inactive')
  }

  const access = evaluateAccountAccess(targetAccount, targetRestrictions, now)
  if (!access.ok) return access
  if (activeRestrictionTypes(targetRestrictions, now).has('NO_EVENTS')) {
    return deny('RESTRICTED', 'This member is barred from event points')
  }

  if (accountAlreadyRegistered) {
    return deny('ALREADY_REGISTERED', 'This account already registered for this event')
  }

  const isAlt = targetCharacter.kind === 'ALT'
  if (isAlt && settings.altPointsPolicy === 'NO_CREDIT') {
    return deny('ALT_NOT_ELIGIBLE', 'Only main characters can earn points in this guild')
  }

  return allow({
    creditUserId: targetCharacter.userId,
    creditCharacterId: isAlt ? (targetCharacter.mainCharacterId ?? targetCharacter.id) : targetCharacter.id,
    points: event.pointsValue,
    needsSecondApproval: event.pointsValue > settings.adminGrantApprovalThreshold,
  })
}

/**
 * Re-scoring an event after people already registered.
 *
 * The ledger is append-only, so a change is expressed as one delta row per
 * existing registration - which is exactly what "update everyone who
 * registered" means. Rows already REVERSED (a cancelled event) are left alone.
 */
export function planPointsChange(params: {
  oldPoints: number
  newPoints: number
  registrations: readonly {
    id: string
    userId: string
    characterId: string
    status: 'PENDING' | 'CONFIRMED' | 'REVERSED'
  }[]
  /**
   * The admin doing the re-scoring. Their own registration is skipped: an
   * admin registered on an event could otherwise hand themselves an arbitrary
   * confirmed delta in one call, which is the same self-payment
   * `evaluateAdminGrant` refuses.
   */
  excludeUserId?: string
}): {
  delta: number
  adjustments: {
    registrationId: string
    userId: string
    characterId: string
    amount: number
    state: 'PENDING' | 'CONFIRMED'
  }[]
} {
  const delta = params.newPoints - params.oldPoints
  if (delta === 0) return { delta: 0, adjustments: [] }

  const adjustments = params.registrations.flatMap((r) => {
    if (r.status === 'REVERSED') return []
    if (params.excludeUserId && r.userId === params.excludeUserId) return []
    // The correction inherits the award's state: points that were not yet
    // spendable stay pending, confirmed ones move immediately.
    const state: 'PENDING' | 'CONFIRMED' = r.status
    return [
      {
        registrationId: r.id,
        userId: r.userId,
        characterId: r.characterId,
        amount: delta,
        state,
      },
    ]
  })

  return { delta, adjustments }
}

/**
 * The quorum an admin may set for one event.
 *
 * The guild's `minParticipants` is a **floor**, not a suggestion. It used to be
 * read as a default only, so an admin could pass 1 in the form, redeem their
 * own code, and watch the event confirm on a single registration - which is
 * precisely the "lone admin invents an event and pays himself" attack the
 * setting exists to prevent.
 */
export function resolveEventQuorum(params: {
  requested: number | undefined
  settings: SettingsLike
}): RuleResult<number> {
  const { requested, settings } = params
  const floor = Math.max(1, settings.minParticipants)

  if (requested === undefined) return allow(floor)
  if (!Number.isInteger(requested) || requested < 1) {
    return deny('INVALID_QUORUM', 'The minimum number of participants must be at least 1')
  }
  if (requested < floor) {
    return deny('INVALID_QUORUM', `This guild requires at least ${floor} participants`)
  }
  return allow(requested)
}

/** The join window an admin may set, clamped to the guild's ceiling. */
export function resolveCodeExpiry(params: {
  ttlMinutes: number
  settings: SettingsLike
  now: Date
}): RuleResult<Date> {
  const { ttlMinutes, settings, now } = params
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) {
    return deny('INVALID_TTL', 'The code lifetime must be at least 1 minute')
  }
  if (ttlMinutes > settings.maxCodeTtlMinutes) {
    return deny('INVALID_TTL', `The code lifetime cannot exceed ${settings.maxCodeTtlMinutes} minutes`)
  }
  return allow(new Date(now.getTime() + ttlMinutes * 60_000))
}

export function resolveConfirmationDeadline(settings: SettingsLike, now: Date): Date {
  return new Date(now.getTime() + settings.confirmationWindowHours * 3_600_000)
}

// ---------------------------------------------------------------------------
// Guild invites
// ---------------------------------------------------------------------------

/**
 * A guild is created only from an invite, and the invite dies in a day.
 *
 * The window is short on purpose: the token travels in a URL, through chat
 * apps that keep history, so the realistic threat is not brute force but a
 * link still working weeks after it was pasted somewhere public.
 */
export const INVITE_TTL_HOURS = 24

export type InviteLike = {
  id: string
  expiresAt: Date
  redeemedAt: Date | null
  revokedAt: Date | null
}

export type InviteStatus = 'LIVE' | 'REDEEMED' | 'REVOKED' | 'EXPIRED'

export function resolveInviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000)
}

/** What an invite is right now. Ordered so the most permanent state wins. */
export function describeInviteStatus(invite: InviteLike, now: Date): InviteStatus {
  if (invite.revokedAt !== null) return 'REVOKED'
  if (invite.redeemedAt !== null) return 'REDEEMED'
  if (now.getTime() >= invite.expiresAt.getTime()) return 'EXPIRED'
  return 'LIVE'
}

/**
 * Minting an invite creates a whole new guild, outside any existing one, so it
 * is not a guild-admin power: a leader who could mint them could spawn guilds
 * forever. Only a super admin, or the operator's CLI, which has no actor.
 */
export function authorizeInviteIssue(actor: Actor): RuleResult<undefined> {
  if (actor.role !== 'SUPER_ADMIN') {
    return deny('FORBIDDEN', 'Only a super admin can issue a guild invite')
  }
  if (!actor.isActive || actor.status !== 'ACTIVE') {
    return deny('ACCOUNT_INACTIVE', 'This account is inactive')
  }
  return allow(undefined)
}

/**
 * Spending an invite.
 *
 * `actor` is the signed-in caller, if any. An account already belongs to
 * exactly one guild, so somebody signed in cannot redeem: doing it would have
 * to move their account, stranding the characters, points and history that are
 * scoped to the guild they are leaving. Refusing is the honest answer.
 */
export function evaluateInviteRedemption(params: {
  invite: InviteLike
  actor: Actor | null
  now: Date
}): RuleResult<{ inviteId: string }> {
  const { invite, actor, now } = params

  if (actor) {
    return deny(
      'ALREADY_IN_GUILD',
      'You already belong to a guild. Sign out and redeem this invite with a new account.',
    )
  }

  const status = describeInviteStatus(invite, now)
  if (status === 'REVOKED') return deny('INVITE_REVOKED', 'This invite was revoked')
  if (status === 'REDEEMED') return deny('INVITE_USED', 'This invite has already been used')
  if (status === 'EXPIRED') return deny('INVITE_EXPIRED', 'This invite has expired')

  return allow({ inviteId: invite.id })
}

// ---------------------------------------------------------------------------
// Recruitment: joining an existing guild
// ---------------------------------------------------------------------------

/** A month. Past that a recruitment link is a door somebody forgot to close. */
export const MEMBER_INVITE_MAX_TTL_HOURS = 720
/** Enough for a recruitment drive, small enough to stay a deliberate act. */
export const MEMBER_INVITE_MAX_USES = 100

export type MemberInviteLike = {
  id: string
  guildId: string
  expiresAt: Date
  maxUses: number
  usedCount: number
  revokedAt: Date | null
}

export type MemberInviteStatus = 'LIVE' | 'REVOKED' | 'EXPIRED' | 'EXHAUSTED'

export function describeMemberInviteStatus(
  invite: MemberInviteLike,
  now: Date,
): MemberInviteStatus {
  if (invite.revokedAt !== null) return 'REVOKED'
  if (now.getTime() >= invite.expiresAt.getTime()) return 'EXPIRED'
  if (invite.usedCount >= invite.maxUses) return 'EXHAUSTED'
  return 'LIVE'
}

/**
 * Issuing a recruitment link is a guild-admin power, unlike a guild invite:
 * it adds somebody to a guild that already exists rather than creating one.
 */
export function evaluateMemberInviteIssue(params: {
  actor: Actor
  guildId: string
  maxUses: number
  ttlHours: number
  /** `LEADER` mints the first admin of a brand-new guild. Super admin only. */
  grantsRole?: 'MEMBER' | 'LEADER'
  now: Date
}): RuleResult<{ expiresAt: Date; maxUses: number; grantsRole: 'MEMBER' | 'LEADER' }> {
  const { actor, guildId, maxUses, ttlHours, now } = params
  const grantsRole = params.grantsRole ?? 'MEMBER'

  if (grantsRole === 'LEADER') {
    // A leader link is issued for a guild the actor does not belong to - the
    // one they just created - so it is gated on the role alone, and only the
    // super admin has it. A guild admin able to mint these could promote
    // anybody, anywhere, to leader.
    if (actor.role !== 'SUPER_ADMIN') {
      return deny('FORBIDDEN', 'Only a super admin can issue a leader link')
    }
    if (!actor.isActive || actor.status !== 'ACTIVE') {
      return deny('ACCOUNT_INACTIVE', 'This account is inactive')
    }
    if (maxUses !== 1) {
      return deny('INVALID_USES', 'A leader link admits exactly one person')
    }
  } else {
    const adminCheck = authorizeAdminAction(actor, guildId)
    if (!adminCheck.ok) return adminCheck
  }

  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MEMBER_INVITE_MAX_USES) {
    return deny('INVALID_USES', `A link can admit between 1 and ${MEMBER_INVITE_MAX_USES} people`)
  }
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > MEMBER_INVITE_MAX_TTL_HOURS) {
    return deny('INVALID_TTL', `The link can last between 1 and ${MEMBER_INVITE_MAX_TTL_HOURS} hours`)
  }

  return allow({ expiresAt: new Date(now.getTime() + ttlHours * 3_600_000), maxUses, grantsRole })
}

export type GuildJoinLike = {
  id: string
  isActive: boolean
  joinPolicy: 'OPEN' | 'INVITE_ONLY'
}

/**
 * Whether this person may sign up into this guild.
 *
 * The two ways in are deliberately not equivalent: an OPEN guild takes anyone
 * from the public directory, while a closed one takes only a live link that
 * was issued for *that* guild. A link for another guild is refused with the
 * same message as a fake one - a token is not a way to enumerate guilds.
 */
export function evaluateJoin(params: {
  guild: GuildJoinLike
  /** The link the visitor arrived with, if any. */
  invite: MemberInviteLike | null
  now: Date
}): RuleResult<{ guildId: string; inviteId: string | null }> {
  const { guild, invite, now } = params

  if (!guild.isActive) {
    return deny('GUILD_NOT_FOUND', 'That guild does not exist or is not accepting members')
  }

  if (invite) {
    if (invite.guildId !== guild.id) {
      return deny('INVITE_INVALID', 'This invite link is not valid')
    }
    const status = describeMemberInviteStatus(invite, now)
    if (status === 'REVOKED') return deny('INVITE_REVOKED', 'This invite was revoked')
    if (status === 'EXPIRED') return deny('INVITE_EXPIRED', 'This invite has expired')
    if (status === 'EXHAUSTED') {
      return deny('INVITE_EXHAUSTED', 'This invite has already been used by everyone it allowed')
    }
    return allow({ guildId: guild.id, inviteId: invite.id })
  }

  if (guild.joinPolicy === 'INVITE_ONLY') {
    return deny('INVITE_REQUIRED', 'This guild only takes members through an invite link')
  }

  return allow({ guildId: guild.id, inviteId: null })
}

// ---------------------------------------------------------------------------
// Character roster
// ---------------------------------------------------------------------------

/**
 * Character names are unique per guild, so an unbounded roster would let one
 * account squat every name other members want, and would bury the audit trail
 * in rows nobody plays. Ten is generous for a real player.
 *
 * The cap counts **every** row, retired ones included: retirement is logical,
 * so a retired character keeps its row and keeps holding its guild-wide name
 * (`characters_guild_name_key` has no `is_active` predicate). Counting only the
 * live ones would leave a create-and-retire loop free to reserve every name in
 * the guild - exactly what this cap exists to prevent.
 */
export const MAX_CHARACTERS_PER_ACCOUNT = 10

/** Control characters would corrupt logs and the audit trail. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export type CharacterDraft = {
  name: string
  race: Race
  biosuit: string
  level: number
  kind: CharacterKind
}

/** The name, class and level every character carries. */
export type CharacterPatch = {
  name: string
  biosuit: string
  level: number
}

/** The build checklist on the classes board. */
export type BuildFlags = {
  skill4: boolean
  skill5: boolean
  skill6: boolean
  skill7: boolean
  constant3: boolean
  painAdaptation: boolean
  trinity: boolean
  techniqueMaster: boolean
}

/** Everything an edit of an existing character may change. */
export type CharacterStatsPatch = CharacterPatch & {
  combatPower: number
  build: BuildFlags
}

/** Above any real RF Next combat power, low enough to stay inside an int4. */
export const MAX_COMBAT_POWER = 100_000_000

export type CharacterCreatePlan = {
  character: CharacterDraft
  /** The MAIN this character rolls its points up to. Null when it IS the main. */
  mainCharacterId: string | null
  /**
   * ALTs created before any MAIN existed (the sign-up form allows it) and are
   * therefore still unlinked. Creating the MAIN adopts them, which is what
   * keeps the rollup in `evaluateRegistration` from falling back to the ALT.
   */
  adoptAltIds: string[]
}

export type MainSwitchPlan = {
  newMainId: string
  /**
   * Demoted first, never in parallel: `characters_one_main_per_user` is a
   * partial unique index and refuses a second MAIN mid-transaction.
   */
  demoteMainId: string | null
  /** Every other ALT, which must now point at the new MAIN. */
  relinkAltIds: string[]
}

function validateCharacterFields(input: CharacterPatch): RuleResult<CharacterPatch> {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 40) {
    return deny('INVALID_NAME', 'The character name must be between 2 and 40 characters')
  }
  if (CONTROL_CHARACTERS.test(name)) {
    return deny('INVALID_NAME', 'The character name contains characters that are not allowed')
  }

  const biosuit = input.biosuit.trim()
  if (biosuit.length < 1 || biosuit.length > 60) {
    return deny('INVALID_BIOSUIT', 'A biosuit is required')
  }
  if (CONTROL_CHARACTERS.test(biosuit)) {
    return deny('INVALID_BIOSUIT', 'The biosuit contains characters that are not allowed')
  }

  if (!Number.isInteger(input.level) || input.level < 1 || input.level > 999) {
    return deny('INVALID_LEVEL', 'The level must be a whole number between 1 and 999')
  }

  return allow({ name, biosuit, level: input.level })
}

/** Every roster entry must belong to the caller's own account and guild. */
function ownsRoster(actor: Actor, roster: readonly CharacterLike[]): boolean {
  return roster.every((c) => c.userId === actor.id && c.guildId === actor.guildId)
}

/**
 * Adding a character to your own roster.
 *
 * The rule that matters is the MAIN link: an ALT may only exist once a MAIN
 * does, and it is created already pointing at it. That is what makes the alt
 * rollup real instead of theoretical - an ALT whose `mainCharacterId` is null
 * silently keeps its own points and breaks the "one main per player" accounting
 * the auctions rely on.
 *
 * `roster` is the caller's whole roster, retired characters included: a retired
 * MAIN still occupies the one-main-per-account slot.
 */
export function evaluateCharacterCreate(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  roster: readonly CharacterLike[]
  input: CharacterDraft
  now: Date
}): RuleResult<CharacterCreatePlan> {
  const { actor, restrictions, roster, input, now } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access

  if (!ownsRoster(actor, roster)) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }

  const fields = validateCharacterFields(input)
  if (!fields.ok) return fields

  // Every row counts, retired included: the name it holds is never released.
  if (roster.length >= MAX_CHARACTERS_PER_ACCOUNT) {
    return deny(
      'ROSTER_FULL',
      `An account can hold at most ${MAX_CHARACTERS_PER_ACCOUNT} characters`,
    )
  }

  const main = roster.find((c) => c.kind === 'MAIN') ?? null
  const character: CharacterDraft = { ...fields.value, race: input.race, kind: input.kind }

  if (input.kind === 'MAIN') {
    if (main) {
      return deny(
        'MAIN_ALREADY_EXISTS',
        'This account already has a main character. Promote another one instead.',
      )
    }
    return allow({
      character,
      mainCharacterId: null,
      adoptAltIds: roster.filter((c) => c.mainCharacterId === null).map((c) => c.id),
    })
  }

  if (!main) {
    return deny('MAIN_REQUIRED', 'Create your main character before adding an alt')
  }
  return allow({ character, mainCharacterId: main.id, adoptAltIds: [] })
}

/**
 * Editing a character: level, combat power, class and build.
 *
 * The owner edits their own characters; an admin of the same guild edits
 * anybody's, because keeping the board accurate is their job. Only an admin
 * may rename: the name is the guild-wide identity other members recognise, so
 * a member quietly taking a respected player's name is not self-service.
 *
 * `kind` is deliberately not patchable by anyone: which character is the MAIN
 * decides where points are attributed and who may bet, so it moves only
 * through `evaluateMainSwitch`, which relinks the whole roster in one audited
 * step and is owner-only.
 *
 * None of these fields touch the ledger. Combat power does gate which loot
 * tiers a member may bet on, which is why an admin can correct it.
 */
export function evaluateCharacterStatsUpdate(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  character: CharacterLike & { name: string }
  input: CharacterStatsPatch
  now: Date
}): RuleResult<CharacterStatsPatch & { viaAdmin: boolean }> {
  const { actor, restrictions, character, input, now } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access

  const ownership = authorizeResource({
    actor,
    ownerUserId: character.userId,
    resourceGuildId: character.guildId,
  })
  if (!ownership.ok) return ownership
  const { viaAdmin } = ownership.value
  const isAdmin = isGuildAdmin(actor.role)

  if (!character.isActive) {
    return deny('CHARACTER_INACTIVE', 'This character is retired')
  }

  const fields = validateCharacterFields(input)
  if (!fields.ok) return fields

  if (!isAdmin && fields.value.name !== character.name) {
    return deny('NAME_CHANGE_ADMIN_ONLY', 'Only an admin can rename a character')
  }

  if (
    !Number.isInteger(input.combatPower) ||
    input.combatPower < 0 ||
    input.combatPower > MAX_COMBAT_POWER
  ) {
    return deny('INVALID_COMBAT_POWER', 'Combat power must be a whole number of zero or more')
  }

  return allow({
    ...fields.value,
    combatPower: input.combatPower,
    build: {
      skill4: input.build.skill4 === true,
      skill5: input.build.skill5 === true,
      skill6: input.build.skill6 === true,
      skill7: input.build.skill7 === true,
      constant3: input.build.constant3 === true,
      painAdaptation: input.build.painAdaptation === true,
      trinity: input.build.trinity === true,
      techniqueMaster: input.build.techniqueMaster === true,
    },
    viaAdmin,
  })
}

/**
 * Promoting one of your characters to MAIN.
 *
 * The old MAIN becomes an ALT of the new one and every other ALT is relinked,
 * so the account always has exactly one MAIN and every ALT rolls up to it.
 * Points already in the ledger are never moved: they are keyed by account, and
 * the ledger is append-only.
 */
export function evaluateMainSwitch(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  roster: readonly CharacterLike[]
  targetCharacterId: string
  now: Date
}): RuleResult<MainSwitchPlan> {
  const { actor, restrictions, roster, targetCharacterId, now } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access

  if (!ownsRoster(actor, roster)) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }

  const target = roster.find((c) => c.id === targetCharacterId)
  // Same denial for "not yours" and "does not exist": never confirm that a
  // character id is real.
  if (!target) return deny('FORBIDDEN', 'You are not allowed to access this resource')
  if (!target.isActive) return deny('CHARACTER_INACTIVE', 'This character is retired')
  if (target.kind === 'MAIN') {
    return deny('ALREADY_MAIN', 'This is already your main character')
  }

  const currentMain = roster.find((c) => c.kind === 'MAIN') ?? null

  return allow({
    newMainId: target.id,
    demoteMainId: currentMain?.id ?? null,
    relinkAltIds: roster
      .filter((c) => c.id !== target.id && c.id !== currentMain?.id)
      .map((c) => c.id),
  })
}

/**
 * Retiring a character (logical deactivation, mirroring how members are
 * deactivated: the row survives so the ledger and the audit trail stay intact).
 *
 * A MAIN is never retirable directly. Promoting a successor first is what stops
 * an account from ending up with orphan ALTs whose points have nowhere to roll
 * up to.
 */
export function evaluateCharacterRetire(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  roster: readonly CharacterLike[]
  targetCharacterId: string
  now: Date
}): RuleResult<{ characterId: string }> {
  const { actor, restrictions, roster, targetCharacterId, now } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access

  if (!ownsRoster(actor, roster)) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }

  const target = roster.find((c) => c.id === targetCharacterId)
  if (!target) return deny('FORBIDDEN', 'You are not allowed to access this resource')
  if (!target.isActive) return deny('CHARACTER_INACTIVE', 'This character is already retired')

  if (roster.filter((c) => c.isActive).length <= 1) {
    return deny('LAST_CHARACTER', 'An account must keep at least one character')
  }
  if (target.kind === 'MAIN') {
    return deny(
      'MAIN_CANNOT_RETIRE',
      'Promote another character to main before retiring this one',
    )
  }

  return allow({ characterId: target.id })
}

// ---------------------------------------------------------------------------
// Weeks & participation
// ---------------------------------------------------------------------------

/**
 * Weekly participation, in percent with one decimal.
 *
 * `eventsHeld` counts the week's events the member could have joined - the
 * ones they created are excluded by the caller, since a creator can never
 * redeem their own code. An excused absence counts as attended, never as
 * points. A week with no events yet is 100%: nobody has missed anything.
 */
export function computeParticipation(params: {
  eventsHeld: number
  eventsAttended: number
  eventsExcused: number
}): number {
  const held = Math.max(0, Math.floor(params.eventsHeld))
  if (held === 0) return 100

  const credited = Math.max(0, params.eventsAttended) + Math.max(0, params.eventsExcused)
  const pct = Math.min(100, (credited / held) * 100)
  return Math.round(pct * 10) / 10
}

/** The shortest week an admin may close: stops a double click burning a week. */
export const MIN_WEEK_HOURS = 1

/**
 * Opening the next week. Participation restarts from zero for everybody, which
 * is also what unlocks or locks loot betting, so it is an admin power.
 */
export function evaluateWeekAdvance(params: {
  actor: Actor
  guildId: string
  currentWeek: { number: number; startedAt: Date } | null
  now: Date
}): RuleResult<{ number: number }> {
  const { actor, guildId, currentWeek, now } = params

  const adminCheck = authorizeAdminAction(actor, guildId)
  if (!adminCheck.ok) return adminCheck

  if (!currentWeek) return allow({ number: 1 })

  if (now.getTime() - currentWeek.startedAt.getTime() < MIN_WEEK_HOURS * 3_600_000) {
    return deny('WEEK_TOO_RECENT', 'The current week has just started')
  }
  return allow({ number: currentWeek.number + 1 })
}

const MAX_REASON_LENGTH = 200

function validateReason(reason: string): RuleResult<string> {
  const trimmed = reason.trim()
  if (trimmed.length < 3 || trimmed.length > MAX_REASON_LENGTH) {
    return deny('REASON_REQUIRED', `A reason between 3 and ${MAX_REASON_LENGTH} characters is required`)
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    return deny('REASON_REQUIRED', 'The reason contains characters that are not allowed')
  }
  return allow(trimmed)
}

export const MAX_EVENTS_EXCUSED = 50

/**
 * Excusing an absence. It raises participation, which is the gate to loot
 * betting - so an admin excusing themselves would be opening their own gate.
 * Refused on the account, like every other self-benefit.
 */
export function evaluateExcuse(params: {
  actor: Actor
  target: { id: string; guildId: string }
  eventsExcused: number
  reason: string
}): RuleResult<{ eventsExcused: number; reason: string }> {
  const { actor, target, eventsExcused } = params

  const adminCheck = authorizeAdminAction(actor, target.guildId)
  if (!adminCheck.ok) return adminCheck

  if (target.id === actor.id) {
    return deny('SELF_EXCUSE_FORBIDDEN', 'An admin cannot excuse their own absence')
  }
  if (!Number.isInteger(eventsExcused) || eventsExcused < 1 || eventsExcused > MAX_EVENTS_EXCUSED) {
    return deny('INVALID_AMOUNT', `Between 1 and ${MAX_EVENTS_EXCUSED} events can be excused`)
  }

  const reason = validateReason(params.reason)
  if (!reason.ok) return reason

  return allow({ eventsExcused, reason: reason.value })
}

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

export const MAX_PENALTY_POINTS = 100_000

/**
 * A penalty is a negative, immediately CONFIRMED ledger row. Deducting never
 * mints, but an admin is still kept off their own account: a penalty is the
 * first half of a reversal, and the reversal is a credit.
 */
export function evaluatePenalty(params: {
  actor: Actor
  target: { id: string; guildId: string }
  points: number
  reason: string
}): RuleResult<{ amount: number; reason: string }> {
  const { actor, target, points } = params

  const adminCheck = authorizeAdminAction(actor, target.guildId)
  if (!adminCheck.ok) return adminCheck

  if (target.id === actor.id) {
    return deny('SELF_PENALTY_FORBIDDEN', 'An admin cannot penalize their own account')
  }
  if (!Number.isInteger(points) || points < 1 || points > MAX_PENALTY_POINTS) {
    return deny('INVALID_AMOUNT', `A penalty must be between 1 and ${MAX_PENALTY_POINTS} points`)
  }

  const reason = validateReason(params.reason)
  if (!reason.ok) return reason

  return allow({ amount: -points, reason: reason.value })
}

/**
 * Undoing a penalty credits exactly what it took, exactly once, and never to
 * the admin doing it - otherwise "penalize, then reverse twice" would mint.
 */
export function evaluatePenaltyReversal(params: {
  actor: Actor
  penalty: { userId: string; guildId: string; kind: string; amount: number; state: string }
  alreadyReversed: boolean
}): RuleResult<{ amount: number }> {
  const { actor, penalty, alreadyReversed } = params

  const adminCheck = authorizeAdminAction(actor, penalty.guildId)
  if (!adminCheck.ok) return adminCheck

  if (penalty.kind !== 'PENALTY' || penalty.amount >= 0 || penalty.state !== 'CONFIRMED') {
    return deny('NOT_FOUND', 'Penalty not found')
  }
  if (penalty.userId === actor.id) {
    return deny('SELF_PENALTY_FORBIDDEN', 'An admin cannot reverse a penalty on their own account')
  }
  if (alreadyReversed) {
    return deny('ALREADY_REVERSED', 'This penalty was already reversed')
  }
  return allow({ amount: -penalty.amount })
}

// ---------------------------------------------------------------------------
// Combat power tiers
// ---------------------------------------------------------------------------

export type CpTier = 'MEGA' | 'TITAN' | 'NONE'
export type LootRestrictionLike = 'ALL' | 'TITAN' | 'MEGA'

/** A threshold of 0 switches that tier off. */
export function classifyCombatPower(
  combatPower: number,
  thresholds: Pick<SettingsLike, 'megaCpThreshold' | 'titanCpThreshold'>,
): CpTier {
  if (thresholds.megaCpThreshold > 0 && combatPower >= thresholds.megaCpThreshold) return 'MEGA'
  if (thresholds.titanCpThreshold > 0 && combatPower >= thresholds.titanCpThreshold) return 'TITAN'
  return 'NONE'
}

/** TITAN items take Titans and Megas; MEGA items take Megas only. */
export function meetsLootRestriction(tier: CpTier, restriction: LootRestrictionLike): boolean {
  if (restriction === 'ALL') return true
  if (restriction === 'TITAN') return tier === 'TITAN' || tier === 'MEGA'
  return tier === 'MEGA'
}

export function evaluateThresholdUpdate(params: {
  actor: Actor
  guildId: string
  megaCpThreshold: number
  titanCpThreshold: number
}): RuleResult<{ megaCpThreshold: number; titanCpThreshold: number }> {
  const { actor, guildId, megaCpThreshold, titanCpThreshold } = params

  const adminCheck = authorizeAdminAction(actor, guildId)
  if (!adminCheck.ok) return adminCheck

  for (const value of [megaCpThreshold, titanCpThreshold]) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_COMBAT_POWER) {
      return deny('INVALID_THRESHOLD', 'A threshold must be a whole number of zero or more')
    }
  }
  if (megaCpThreshold > 0 && titanCpThreshold > 0 && titanCpThreshold > megaCpThreshold) {
    return deny('INVALID_THRESHOLD', 'The Titan threshold cannot be above the Mega threshold')
  }
  return allow({ megaCpThreshold, titanCpThreshold })
}

// ---------------------------------------------------------------------------
// Loot raffle
// ---------------------------------------------------------------------------

export const LOOT_MAX_ITEMS_PER_BANNER = 20
export const LOOT_MAX_BANNER_HOURS = 720
export const LOOT_MAX_ITEM_POINTS = 1_000_000

export type LootItemDraft = {
  name: string
  maxPoints: number
  restriction: LootRestrictionLike
}

export type LootBannerLike = {
  id: string
  guildId: string
  status: 'OPEN' | 'CLOSED'
  closesAt: Date | null
}

export type LootItemLike = {
  id: string
  guildId: string
  bannerId: string
  status: 'OPEN' | 'DRAWN' | 'CANCELLED'
  maxPoints: number
  restriction: LootRestrictionLike
}

/** Bets are taken while the banner is open and its deadline, if any, is ahead. */
export function isBannerAcceptingBets(banner: LootBannerLike, now: Date): boolean {
  if (banner.status !== 'OPEN') return false
  return banner.closesAt === null || now.getTime() < banner.closesAt.getTime()
}

function validateItemName(name: string): RuleResult<string> {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 120 || CONTROL_CHARACTERS.test(trimmed)) {
    return deny('INVALID_ITEM_NAME', 'The item name must be between 2 and 120 characters')
  }
  return allow(trimmed)
}

/**
 * Publishing a banner. One open banner per guild, so the wheel members are
 * betting on is never ambiguous.
 */
export function evaluateLootBannerCreate(params: {
  actor: Actor
  guildId: string
  title: string
  durationHours: number | null
  items: readonly LootItemDraft[]
  hasOpenBanner: boolean
  now: Date
}): RuleResult<{ title: string; closesAt: Date | null; items: LootItemDraft[] }> {
  const { actor, guildId, durationHours, items, hasOpenBanner, now } = params

  const adminCheck = authorizeAdminAction(actor, guildId)
  if (!adminCheck.ok) return adminCheck

  if (hasOpenBanner) {
    return deny('BANNER_ALREADY_OPEN', 'Close the current loot banner before publishing another')
  }

  const title = params.title.trim()
  if (title.length < 2 || title.length > 120 || CONTROL_CHARACTERS.test(title)) {
    return deny('INVALID_TITLE', 'The title must be between 2 and 120 characters')
  }

  if (
    durationHours !== null &&
    (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > LOOT_MAX_BANNER_HOURS)
  ) {
    return deny('INVALID_TTL', `The deadline must be between 1 and ${LOOT_MAX_BANNER_HOURS} hours`)
  }

  if (items.length < 1 || items.length > LOOT_MAX_ITEMS_PER_BANNER) {
    return deny('INVALID_ITEMS', `A banner holds between 1 and ${LOOT_MAX_ITEMS_PER_BANNER} items`)
  }

  const cleaned: LootItemDraft[] = []
  for (const item of items) {
    const name = validateItemName(item.name)
    if (!name.ok) return name
    if (
      !Number.isInteger(item.maxPoints) ||
      item.maxPoints < 1 ||
      item.maxPoints > LOOT_MAX_ITEM_POINTS
    ) {
      return deny('INVALID_AMOUNT', `An item cap must be between 1 and ${LOOT_MAX_ITEM_POINTS} points`)
    }
    cleaned.push({ name: name.value, maxPoints: item.maxPoints, restriction: item.restriction })
  }

  return allow({
    title,
    closesAt: durationHours === null ? null : new Date(now.getTime() + durationHours * 3_600_000),
    items: cleaned,
  })
}

/** Extending a deadline. Counted from the later of the deadline and now. */
export function evaluateBannerExtend(params: {
  actor: Actor
  banner: LootBannerLike
  hours: number
  now: Date
}): RuleResult<{ closesAt: Date }> {
  const { actor, banner, hours, now } = params

  const adminCheck = authorizeAdminAction(actor, banner.guildId)
  if (!adminCheck.ok) return adminCheck

  if (banner.status !== 'OPEN') return deny('LOOT_CLOSED', 'This loot banner is closed')
  if (banner.closesAt === null) {
    return deny('NO_DEADLINE', 'This banner has no deadline to extend')
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    return deny('INVALID_TTL', 'An extension must be between 1 and 168 hours')
  }

  const base = Math.max(banner.closesAt.getTime(), now.getTime())
  return allow({ closesAt: new Date(base + hours * 3_600_000) })
}

/**
 * Placing a bet.
 *
 * The points are held (a CONFIRMED negative row) the moment the bet lands, so
 * the same points can never back two bets. Only a loser gets them back: the
 * winner's hold becomes the price.
 */
export function evaluateLootBet(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  character: CharacterLike & { combatPower: number }
  banner: LootBannerLike
  item: LootItemLike
  participationPct: number
  settings: Pick<SettingsLike, 'megaCpThreshold' | 'titanCpThreshold' | 'lootMinParticipationPct'>
  /** Spendable points, holds already deducted. */
  availablePoints: number
  hasActiveBet: boolean
  points: number
  now: Date
}): RuleResult<{ points: number }> {
  const {
    actor,
    restrictions,
    character,
    banner,
    item,
    participationPct,
    settings,
    availablePoints,
    hasActiveBet,
    points,
    now,
  } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access
  if (activeRestrictionTypes(restrictions, now).has('NO_LOOT')) {
    return deny('RESTRICTED', 'You are currently barred from loot bets')
  }

  if (character.userId !== actor.id || character.guildId !== actor.guildId) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  if (
    item.guildId !== actor.guildId ||
    banner.guildId !== actor.guildId ||
    item.bannerId !== banner.id
  ) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  // Points belong to the account and are spent by its MAIN, as the ranking
  // shows them. An ALT betting would be the same account under another name.
  if (character.kind !== 'MAIN') {
    return deny('MAIN_CHARACTER_REQUIRED', 'Only a main character can bet on loot')
  }
  if (!character.isActive) return deny('CHARACTER_INACTIVE', 'This character is inactive')

  if (!isBannerAcceptingBets(banner, now)) {
    return deny('LOOT_CLOSED', 'This loot banner is no longer taking bets')
  }
  if (item.status !== 'OPEN') return deny('ITEM_NOT_OPEN', 'This item was already drawn')

  if (participationPct < settings.lootMinParticipationPct) {
    return deny(
      'PARTICIPATION_TOO_LOW',
      `At least ${settings.lootMinParticipationPct}% weekly participation is required to bet`,
    )
  }

  const tier = classifyCombatPower(character.combatPower, settings)
  if (!meetsLootRestriction(tier, item.restriction)) {
    return deny(
      'TIER_REQUIRED',
      item.restriction === 'MEGA'
        ? 'Only Mega members can bet on this item'
        : 'Only Titan or Mega members can bet on this item',
    )
  }

  if (hasActiveBet) return deny('ALREADY_BET', 'You already have a bet on this item')

  if (!Number.isInteger(points) || points < 1) {
    return deny('INVALID_AMOUNT', 'The bet must be a positive whole number of points')
  }
  if (points > item.maxPoints) {
    return deny('BET_ABOVE_MAX', `The most a bet on this item can carry is ${item.maxPoints} points`)
  }
  // Only CONFIRMED points are spendable: a bet can never be funded by an event
  // that is still one registration away from being cancelled.
  if (points > availablePoints) {
    return deny('INSUFFICIENT_POINTS', 'You do not have enough confirmed points for this bet')
  }

  return allow({ points })
}

/**
 * Withdrawing a bet hands the hold back. The owner may do it while bets are
 * being taken; an admin may do it for anybody until the item is drawn.
 */
export function evaluateBetWithdrawal(params: {
  actor: Actor
  bet: { userId: string; guildId: string; status: 'ACTIVE' | 'WON' | 'RELEASED' }
  item: Pick<LootItemLike, 'status'>
  banner: LootBannerLike
  now: Date
}): RuleResult<{ viaAdmin: boolean }> {
  const { actor, bet, item, banner, now } = params

  const ownership = authorizeResource({
    actor,
    ownerUserId: bet.userId,
    resourceGuildId: bet.guildId,
  })
  if (!ownership.ok) return ownership

  if (bet.status !== 'ACTIVE' || item.status !== 'OPEN') {
    return deny('BET_SETTLED', 'This bet was already settled')
  }
  if (!ownership.value.viaAdmin && !isBannerAcceptingBets(banner, now)) {
    return deny('LOOT_CLOSED', 'Bets are locked until the draw')
  }
  return allow(ownership.value)
}

export type WheelSlice = {
  kind: 'STAFF' | 'BET'
  /** The bet this slice belongs to; null for the staff slice. */
  betId: string | null
  label: string
  /** Probability, 0..1. The slices of one wheel sum to 1. */
  weight: number
}

/**
 * The wheel.
 *
 * The staff slice is a fixed share of every wheel. The rest is split between
 * the bets in proportion to their points - however few points are on the
 * table in total, the bettors always share the whole remainder. With no staff
 * member picked, the bettors share everything.
 */
export function buildLootWheel(params: {
  bets: readonly { id: string; label: string; points: number }[]
  staffLabel: string | null
  staffSharePct: number
}): WheelSlice[] {
  const bets = params.bets.filter((b) => Number.isFinite(b.points) && b.points > 0)
  if (bets.length === 0) return []

  const staffShare =
    params.staffLabel === null ? 0 : Math.min(100, Math.max(0, params.staffSharePct)) / 100
  const total = bets.reduce((sum, b) => sum + b.points, 0)

  const slices: WheelSlice[] = bets.map((b) => ({
    kind: 'BET',
    betId: b.id,
    label: b.label,
    weight: ((1 - staffShare) * b.points) / total,
  }))

  if (staffShare > 0 && params.staffLabel !== null) {
    slices.push({ kind: 'STAFF', betId: null, label: params.staffLabel, weight: staffShare })
  }
  return slices
}

/**
 * Picks the slice a roll in [0, 1) lands on. The roll is injected - the
 * service draws it from a CSPRNG - so the choice itself is testable.
 */
export function pickWheelSlice(slices: readonly WheelSlice[], roll: number): WheelSlice | null {
  if (slices.length === 0) return null
  const clamped = Math.min(Math.max(roll, 0), 1 - Number.EPSILON)

  let cumulative = 0
  for (const slice of slices) {
    cumulative += slice.weight
    if (clamped < cumulative) return slice
  }
  // Floating point can leave the sum a hair under 1.
  return slices[slices.length - 1] ?? null
}

/**
 * Running a draw. The randomness is server-side and the draw settles in the
 * same transaction, so there is no "spin again". What is left to guard is the
 * person pressing the button: an admin with a bet on the item may not be the
 * one who draws it.
 */
export function evaluateLootDraw(params: {
  actor: Actor
  item: LootItemLike
  bets: readonly { userId: string }[]
  staff: { id: string; guildId: string; role: UserRole } | null
}): RuleResult<undefined> {
  const { actor, item, bets, staff } = params

  const adminCheck = authorizeAdminAction(actor, item.guildId)
  if (!adminCheck.ok) return adminCheck

  if (item.status !== 'OPEN') return deny('ITEM_NOT_OPEN', 'This item was already drawn')
  if (bets.length === 0) return deny('NO_BETS', 'Nobody has bet on this item yet')
  if (bets.some((b) => b.userId === actor.id)) {
    return deny('SELF_DRAW_FORBIDDEN', 'Another admin must draw an item you bet on')
  }
  if (staff !== null && (staff.guildId !== item.guildId || !isGuildAdmin(staff.role))) {
    return deny('INVALID_STAFF', 'The staff slice must belong to an admin of this guild')
  }
  return allow(undefined)
}

// ---------------------------------------------------------------------------
// Meme raffle
// ---------------------------------------------------------------------------

export const MEME_MAX_CANDIDATES = 200

/** A points-free raffle among members an admin picks. */
export function evaluateMemeDraw(params: {
  actor: Actor
  guildId: string
  itemName: string
  candidates: readonly { id: string; guildId: string; isActive: boolean }[]
  requestedCount: number
}): RuleResult<{ itemName: string }> {
  const { actor, guildId, candidates, requestedCount } = params

  const adminCheck = authorizeAdminAction(actor, guildId)
  if (!adminCheck.ok) return adminCheck

  const name = validateItemName(params.itemName)
  if (!name.ok) return name

  if (requestedCount < 1 || requestedCount > MEME_MAX_CANDIDATES) {
    return deny('INVALID_CANDIDATES', `Pick between 1 and ${MEME_MAX_CANDIDATES} members`)
  }
  // Every id asked for must have loaded, from this guild, and be active. A
  // missing one is treated like a foreign one: never confirm what exists.
  if (
    candidates.length !== requestedCount ||
    candidates.some((c) => c.guildId !== guildId || !c.isActive)
  ) {
    return deny('INVALID_CANDIDATES', 'Every candidate must be an active member of this guild')
  }
  return allow({ itemName: name.value })
}

/** Uniform index in [0, count) from a roll in [0, 1). */
export function pickUniformIndex(count: number, roll: number): number {
  if (count <= 0) return -1
  const clamped = Math.min(Math.max(roll, 0), 1 - Number.EPSILON)
  return Math.min(count - 1, Math.floor(clamped * count))
}

// ---------------------------------------------------------------------------
// Boss schedule
// ---------------------------------------------------------------------------

/** The guild plays on Brasilia time, which has had no daylight saving since 2019. */
export const BRT_OFFSET_HOURS = -3

export type BossRespawnKindLike = 'INTERVAL' | 'DAILY' | 'WEEKLY'

export type BossSchedule = {
  respawnKind: BossRespawnKindLike
  intervalHours: number | null
  anchorAt: Date | null
  dailyTimes: string | null
  weekdays: string | null
}

export type ClockTime = { hour: number; minute: number }

/** "16:00, 22:30" -> [{16,0},{22,30}]. Null when any entry is malformed. */
export function parseDailyTimes(text: string | null): ClockTime[] | null {
  if (text === null) return null
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0 || parts.length > 24) return null

  const times: ClockTime[] = []
  for (const part of parts) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(part)
    if (!match) return null
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour > 23 || minute > 59) return null
    times.push({ hour, minute })
  }
  return times
}

/** "0,3,5" -> [0,3,5], 0 = Sunday. Null when any entry is malformed. */
export function parseWeekdays(text: string | null): number[] | null {
  if (text === null) return null
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0 || parts.length > 7) return null

  const days: number[] = []
  for (const part of parts) {
    if (!/^[0-6]$/.test(part)) return null
    days.push(Number(part))
  }
  return [...new Set(days)].sort((a, b) => a - b)
}

/** Normalises a schedule, dropping the fields its kind does not use. */
export function validateBossSchedule(schedule: BossSchedule): RuleResult<BossSchedule> {
  const base = { intervalHours: null, anchorAt: null, dailyTimes: null, weekdays: null }

  if (schedule.respawnKind === 'INTERVAL') {
    const hours = schedule.intervalHours
    if (hours === null || !Number.isInteger(hours) || hours < 1 || hours > 720) {
      return deny('INVALID_SCHEDULE', 'The respawn interval must be between 1 and 720 hours')
    }
    if (schedule.anchorAt === null || Number.isNaN(schedule.anchorAt.getTime())) {
      return deny('INVALID_SCHEDULE', 'An interval respawn needs a known spawn time')
    }
    return allow({
      ...base,
      respawnKind: 'INTERVAL',
      intervalHours: hours,
      anchorAt: schedule.anchorAt,
    })
  }

  const times = parseDailyTimes(schedule.dailyTimes)
  if (!times) {
    return deny('INVALID_SCHEDULE', 'Spawn times must look like 16:00, 22:30')
  }
  const dailyTimes = times
    .map((t) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`)
    .join(', ')

  if (schedule.respawnKind === 'DAILY') {
    return allow({ ...base, respawnKind: 'DAILY', dailyTimes })
  }

  const days = parseWeekdays(schedule.weekdays)
  if (!days) return deny('INVALID_SCHEDULE', 'Pick at least one weekday')
  return allow({ ...base, respawnKind: 'WEEKLY', dailyTimes, weekdays: days.join(',') })
}

/** A boss in a group follows the group; a boss on its own uses its own fields. */
export function resolveBossSchedule(
  boss: {
    respawnKind: BossRespawnKindLike | null
    intervalHours: number | null
    anchorAt: Date | null
    dailyTimes: string | null
    weekdays: string | null
  },
  group: BossSchedule | null,
): BossSchedule | null {
  if (group) return group
  if (boss.respawnKind === null) return null
  return {
    respawnKind: boss.respawnKind,
    intervalHours: boss.intervalHours,
    anchorAt: boss.anchorAt,
    dailyTimes: boss.dailyTimes,
    weekdays: boss.weekdays,
  }
}

const HOUR_MS = 3_600_000

/** The instant a BRT wall-clock time falls on, `dayOffset` days from today in BRT. */
function brtInstant(now: Date, dayOffset: number, time: ClockTime): number {
  const brtNow = new Date(now.getTime() + BRT_OFFSET_HOURS * HOUR_MS)
  return (
    Date.UTC(
      brtNow.getUTCFullYear(),
      brtNow.getUTCMonth(),
      brtNow.getUTCDate() + dayOffset,
      time.hour,
      time.minute,
    ) -
    BRT_OFFSET_HOURS * HOUR_MS
  )
}

/**
 * The next spawn strictly after `now`, or null when the schedule cannot
 * produce one. An interval boss that spawns exactly now is already up, so its
 * next spawn is a full cycle away.
 */
export function nextSpawn(schedule: BossSchedule, now: Date): Date | null {
  const nowMs = now.getTime()

  if (schedule.respawnKind === 'INTERVAL') {
    if (schedule.anchorAt === null || schedule.intervalHours === null) return null
    const interval = schedule.intervalHours * HOUR_MS
    if (interval <= 0) return null
    const anchor = schedule.anchorAt.getTime()
    if (anchor > nowMs) return new Date(anchor)
    const cycles = Math.floor((nowMs - anchor) / interval) + 1
    return new Date(anchor + cycles * interval)
  }

  const times = parseDailyTimes(schedule.dailyTimes)
  if (!times) return null

  if (schedule.respawnKind === 'DAILY') {
    let best: number | null = null
    for (const time of times) {
      let at = brtInstant(now, 0, time)
      if (at <= nowMs) at = brtInstant(now, 1, time)
      if (best === null || at < best) best = at
    }
    return best === null ? null : new Date(best)
  }

  const days = parseWeekdays(schedule.weekdays)
  if (!days) return null
  const todayBrt = new Date(nowMs + BRT_OFFSET_HOURS * HOUR_MS).getUTCDay()

  let best: number | null = null
  for (let offset = 0; offset <= 7; offset++) {
    if (!days.includes((todayBrt + offset) % 7)) continue
    for (const time of times) {
      const at = brtInstant(now, offset, time)
      if (at > nowMs && (best === null || at < best)) best = at
    }
  }
  return best === null ? null : new Date(best)
}

/** The BRT calendar day an instant falls on: a stable key plus its parts. */
export function brtDay(at: Date): { key: string; weekday: number; day: number; month: number } {
  const brt = new Date(at.getTime() + BRT_OFFSET_HOURS * HOUR_MS)
  const month = brt.getUTCMonth() + 1
  return {
    key: `${brt.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`,
    weekday: brt.getUTCDay(),
    day: brt.getUTCDate(),
    month,
  }
}

// ---------------------------------------------------------------------------
// Approving a sign-up
// ---------------------------------------------------------------------------

/**
 * Anyone may create an account; nobody gets in on their own.
 *
 * Sign-up is deliberately open (the guild would rather people register than
 * chase links), so the gate moved one step later: an account has no access
 * until a leader or the super admin vouches for it. Vice-leaders cannot -
 * letting people in decides who is in the guild, which is the leader's call.
 *
 * A link issued by an admin is vouching in itself, so accounts created through
 * one arrive approved and never reach this rule.
 */
export function evaluateApproval(params: {
  actor: Actor
  target: { id: string; guildId: string; approvedAt: Date | null; deletedAt: Date | null }
}): RuleResult<undefined> {
  const { actor, target } = params

  if (actor.guildId !== target.guildId) return deny('FORBIDDEN', 'Wrong guild')
  if (actor.role !== 'LEADER' && actor.role !== 'SUPER_ADMIN') {
    return deny('FORBIDDEN', 'Only a leader or the super admin can approve a sign-up')
  }
  if (target.id === actor.id) {
    return deny('SELF_APPROVAL_FORBIDDEN', 'You cannot approve your own account')
  }
  if (target.deletedAt !== null) {
    return deny('ACCOUNT_DELETED', 'This account no longer has access')
  }
  if (target.approvedAt !== null) {
    return deny('ALREADY_APPROVED', 'This account was already approved')
  }
  return allow(undefined)
}

// ---------------------------------------------------------------------------
// Creating another guild
// ---------------------------------------------------------------------------

/** Lowercase, hyphen-separated, no accents: the slug a guild is reached by. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export type GuildDraft = { name: string; slug: string; tag: string | null }

/**
 * Creating a guild is not a guild-admin power.
 *
 * This portal belongs to one guild; another one is a second tenant on the same
 * deployment, and a leader able to mint them could spawn tenants forever. Only
 * the super admin, who is the operator of the install.
 *
 * The new guild gets no members here: it comes with a single-use link that
 * makes whoever redeems it its LEADER (`evaluateMemberInviteIssue`), so the
 * super admin never has to leave their own guild to set one up.
 */
export function evaluateGuildCreate(params: {
  actor: Actor
  name: string
  tag: string | null
}): RuleResult<GuildDraft> {
  const { actor } = params

  if (actor.role !== 'SUPER_ADMIN') {
    return deny('FORBIDDEN', 'Only a super admin can create a guild')
  }
  if (!actor.isActive || actor.status !== 'ACTIVE') {
    return deny('ACCOUNT_INACTIVE', 'This account is inactive')
  }

  const name = params.name.trim()
  if (name.length < 2 || name.length > 60 || CONTROL_CHARACTERS.test(name)) {
    return deny('INVALID_GUILD_NAME', 'The guild name must be between 2 and 60 characters')
  }

  const slug = slugify(name)
  if (slug.length < 2) {
    return deny('INVALID_GUILD_NAME', 'The guild name must contain letters or digits')
  }

  const tag = params.tag?.trim() ?? ''
  if (tag.length > 8 || CONTROL_CHARACTERS.test(tag)) {
    return deny('INVALID_GUILD_TAG', 'The tag can have at most 8 characters')
  }

  return allow({ name, slug, tag: tag.length > 0 ? tag : null })
}
