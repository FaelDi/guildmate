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
  ItemRarity,
  ItemType,
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
  auctionAntiSnipeSeconds: number
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
// Auctions (points)
// ---------------------------------------------------------------------------

export type AuctionLike = {
  id: string
  guildId: string
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'SETTLED' | 'CANCELLED'
  startingBid: number
  minIncrement: number
  currentBid: number | null
  currentBidderUserId: string | null
  endsAt: Date
}

/** The smallest bid that would currently win. */
export function minimumBid(auction: Pick<AuctionLike, 'startingBid' | 'minIncrement' | 'currentBid'>): number {
  return auction.currentBid === null ? auction.startingBid : auction.currentBid + auction.minIncrement
}

export function evaluateBid(params: {
  auction: AuctionLike
  actor: Actor
  character: CharacterLike
  restrictions: readonly RestrictionLike[]
  /** Spendable points, holds already deducted. */
  availablePoints: number
  amount: number
  now: Date
}): RuleResult<{ amount: number }> {
  const { auction, actor, character, restrictions, availablePoints, amount, now } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access
  if (activeRestrictionTypes(restrictions, now).has('NO_AUCTION')) {
    return deny('RESTRICTED', 'You are currently barred from bidding')
  }

  if (character.userId !== actor.id || character.guildId !== auction.guildId) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  // "Only main characters may spend points in auctions."
  if (character.kind !== 'MAIN') {
    return deny('MAIN_CHARACTER_REQUIRED', 'Only a main character can bid in auctions')
  }
  if (!character.isActive) {
    return deny('CHARACTER_INACTIVE', 'This character is inactive')
  }

  if (auction.status !== 'OPEN') return deny('AUCTION_CLOSED', 'This auction is not open')
  if (now.getTime() >= auction.endsAt.getTime()) {
    return deny('AUCTION_ENDED', 'This auction has ended')
  }
  if (auction.currentBidderUserId === actor.id) {
    return deny('ALREADY_WINNING', 'You are already the highest bidder')
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return deny('INVALID_AMOUNT', 'The bid must be a positive whole number of points')
  }
  const floor = minimumBid(auction)
  if (amount < floor) {
    return deny('BID_TOO_LOW', `The minimum bid is ${floor} points`)
  }
  // Only CONFIRMED points can be spent, so a bid can never be funded by an
  // event that is still one registration away from being cancelled.
  if (amount > availablePoints) {
    return deny('INSUFFICIENT_POINTS', 'You do not have enough confirmed points for this bid')
  }

  return allow({ amount })
}

/**
 * Anti-sniping: a bid placed inside the closing window pushes the end forward,
 * so an auction cannot be stolen in the last second.
 */
export function applyAntiSnipe(endsAt: Date, now: Date, antiSnipeSeconds: number): Date {
  if (antiSnipeSeconds <= 0) return endsAt
  const threshold = now.getTime() + antiSnipeSeconds * 1000
  return threshold > endsAt.getTime() ? new Date(threshold) : endsAt
}

// ---------------------------------------------------------------------------
// Guild store (diamonds)
// ---------------------------------------------------------------------------

export type ListingInput = {
  itemName: string
  itemType: ItemType
  rarity: ItemRarity
  itemLevel: number
  priceDiamonds: number
  quantity: number
}

export function evaluateListingCreate(params: {
  actor: Actor
  character: CharacterLike
  restrictions: readonly RestrictionLike[]
  input: ListingInput
  now: Date
}): RuleResult<ListingInput> {
  const { actor, character, restrictions, input, now } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access
  if (activeRestrictionTypes(restrictions, now).has('NO_MARKET')) {
    return deny('RESTRICTED', 'You are currently barred from listing items')
  }

  // A member lists items owned by their own characters, never someone else's.
  if (character.userId !== actor.id || character.guildId !== actor.guildId) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  if (!character.isActive) return deny('CHARACTER_INACTIVE', 'This character is inactive')

  const name = input.itemName.trim()
  if (name.length < 2 || name.length > 120) {
    return deny('INVALID_NAME', 'The item name must be between 2 and 120 characters')
  }
  if (!Number.isInteger(input.priceDiamonds) || input.priceDiamonds < 1) {
    return deny('INVALID_PRICE', 'The price must be at least 1 diamond')
  }
  if (!Number.isInteger(input.itemLevel) || input.itemLevel < 1 || input.itemLevel > 999) {
    return deny('INVALID_LEVEL', 'The item level must be between 1 and 999')
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 9999) {
    return deny('INVALID_QUANTITY', 'The quantity must be between 1 and 9999')
  }

  return allow({ ...input, itemName: name })
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

/** The fields a member may edit after a character exists. */
export type CharacterPatch = {
  name: string
  biosuit: string
  level: number
}

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
 * Editing a character.
 *
 * `kind` is deliberately not patchable: which character is the MAIN decides
 * where points are attributed and who may bid, so it moves only through
 * `evaluateMainSwitch`, which relinks the whole roster in one audited step.
 */
export function evaluateCharacterUpdate(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  character: CharacterLike
  input: CharacterPatch
  now: Date
}): RuleResult<CharacterPatch> {
  const { actor, restrictions, character, input, now } = params

  const access = evaluateAccountAccess(
    { status: actor.status, isActive: actor.isActive, deletedAt: null },
    restrictions,
    now,
  )
  if (!access.ok) return access

  if (character.userId !== actor.id || character.guildId !== actor.guildId) {
    return deny('FORBIDDEN', 'You are not allowed to access this resource')
  }
  if (!character.isActive) {
    return deny('CHARACTER_INACTIVE', 'This character is retired')
  }

  return validateCharacterFields(input)
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
