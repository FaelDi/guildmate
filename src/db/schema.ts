import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Guild-scoped permission tier. LEADER and VICE_LEADER are "admins". */
export const userRoleEnum = pgEnum('user_role', ['MEMBER', 'VICE_LEADER', 'LEADER', 'SUPER_ADMIN'])

/**
 * Account lifecycle.
 * ACTIVE   - normal access.
 * INACTIVE - logically deactivated (is_active = false); data kept, no sign-in.
 * BANNED   - access denied by an active restriction of type BAN/SUSPENSION.
 * DELETED  - access permanently removed; row kept so the audit trail and the
 *            point ledger stay referentially intact.
 */
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'INACTIVE', 'BANNED', 'DELETED'])

export const characterKindEnum = pgEnum('character_kind', ['MAIN', 'ALT'])

/** RF Online / RF Next races. The biosuit catalogue is scoped by race. */
export const raceEnum = pgEnum('race', ['BELLATO', 'CORA', 'ACCRETIA'])

/**
 * OPEN                 - inside the join window, still accepting codes.
 * PENDING_CONFIRMATION - join window closed, waiting for the quorum deadline.
 * CONFIRMED            - reached min participants; points became spendable.
 * CANCELLED            - quorum missed or cancelled by an admin; points reversed.
 */
export const eventStatusEnum = pgEnum('event_status', [
  'OPEN',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'CANCELLED',
])

export const registrationStatusEnum = pgEnum('registration_status', [
  'PENDING',
  'CONFIRMED',
  'REVERSED',
])

/** How a registration came to exist. ADMIN_GRANT is the manual scoring path. */
export const registrationSourceEnum = pgEnum('registration_source', ['SELF_CODE', 'ADMIN_GRANT'])

export const ledgerKindEnum = pgEnum('ledger_kind', [
  'EVENT_AWARD',
  'EVENT_ADJUSTMENT',
  'EVENT_REVERSAL',
  'ADMIN_ADJUSTMENT',
  /** Points locked by an active loot bet (negative). */
  'LOOT_HOLD',
  /** A losing or withdrawn bet handing its hold back (positive). */
  'LOOT_RELEASE',
  /** A deduction an admin applies to a member (negative). */
  'PENALTY',
  /** Undoing one penalty, exactly once and for exactly its amount (positive). */
  'PENALTY_REVERSAL',
])

/**
 * PENDING   - earned but not yet spendable (event has not reached quorum).
 * CONFIRMED - counts towards the spendable balance.
 * REVERSED  - voided; contributes nothing.
 */
export const ledgerStateEnum = pgEnum('ledger_state', ['PENDING', 'CONFIRMED', 'REVERSED'])

export const restrictionTypeEnum = pgEnum('restriction_type', [
  'BAN',
  'SUSPENSION',
  'NO_EVENTS',
  /** Barred from betting on loot. */
  'NO_LOOT',
])

/**
 * Who may bet on a loot item, by combat power tier.
 * ALL   - any member.
 * TITAN - combat power at or above the guild's Titan threshold.
 * MEGA  - combat power at or above the guild's Mega threshold.
 */
export const lootRestrictionEnum = pgEnum('loot_restriction', ['ALL', 'TITAN', 'MEGA'])

export const lootBannerStatusEnum = pgEnum('loot_banner_status', ['OPEN', 'CLOSED'])

/**
 * OPEN      - taking bets.
 * DRAWN     - the raffle ran; the winner is recorded on the row.
 * CANCELLED - the banner closed before the draw; every bet was released.
 */
export const lootItemStatusEnum = pgEnum('loot_item_status', ['OPEN', 'DRAWN', 'CANCELLED'])

/**
 * ACTIVE   - holding points.
 * WON      - the winning bet; its hold is the price paid and is never released.
 * RELEASED - lost or withdrawn; the hold was returned by a LOOT_RELEASE row.
 */
export const lootBetStatusEnum = pgEnum('loot_bet_status', ['ACTIVE', 'WON', 'RELEASED'])

/**
 * INTERVAL - every `interval_hours` from an anchor instant.
 * DAILY    - at fixed BRT times every day.
 * WEEKLY   - at fixed BRT times on the listed weekdays.
 */
export const bossRespawnKindEnum = pgEnum('boss_respawn_kind', ['INTERVAL', 'DAILY', 'WEEKLY'])

/** Whether points earned by an ALT are credited to the account or discarded. */
export const altPointsPolicyEnum = pgEnum('alt_points_policy', ['CREDIT_MAIN', 'NO_CREDIT'])

/**
 * How a member gets in.
 * OPEN        - anyone can sign up into the guild from the public directory.
 * INVITE_ONLY - an admin's link is required. The directory still lists the
 *               guild, so it can be found, just not joined.
 */
export const joinPolicyEnum = pgEnum('join_policy', ['OPEN', 'INVITE_ONLY'])

// ---------------------------------------------------------------------------
// Guild
// ---------------------------------------------------------------------------

export const guilds = pgTable(
  'guilds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    tag: text('tag'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('guilds_slug_key').on(t.slug)],
)

/**
 * One row per guild. Every anti-fraud threshold is configurable here so the
 * rules can be tuned without a deploy.
 */
export const guildSettings = pgTable('guild_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  /** Registrations required for an event to confirm. Defaults to the 3 the CEO asked for. */
  minParticipants: integer('min_participants').notNull().default(3),
  /** Hours after creation before an under-quorum event is auto-cancelled. */
  confirmationWindowHours: integer('confirmation_window_hours').notNull().default(48),
  /** Default lifetime of an event join code, in minutes. */
  /** One hour: long enough for latecomers, short enough that a leaked code dies. */
  defaultCodeTtlMinutes: integer('default_code_ttl_minutes').notNull().default(60),
  /** Hard cap on the join-code lifetime an admin may pick. */
  maxCodeTtlMinutes: integer('max_code_ttl_minutes').notNull().default(720),
  /** Per-account cap on self-code registrations in a rolling 24h window. */
  maxRegistrationsPerDay: integer('max_registrations_per_day').notNull().default(12),
  /** Minimum character level allowed to register for events. */
  minLevelToRegister: integer('min_level_to_register').notNull().default(1),
  altPointsPolicy: altPointsPolicyEnum('alt_points_policy').notNull().default('CREDIT_MAIN'),
  /**
   * Defaults to OPEN so an existing guild keeps behaving as it did the day
   * before this column existed. A guild closes itself deliberately.
   */
  joinPolicy: joinPolicyEnum('join_policy').notNull().default('OPEN'),
  /** Combat power at which a member counts as Mega (the gold highlight). */
  megaCpThreshold: integer('mega_cp_threshold').notNull().default(190000),
  /** Combat power at which a member counts as Titan (the blue highlight). */
  titanCpThreshold: integer('titan_cp_threshold').notNull().default(155000),
  /** Weekly participation, in percent, required to bet on loot. */
  lootMinParticipationPct: integer('loot_min_participation_pct').notNull().default(90),
  /** Fixed share of every loot wheel reserved for the staff, in percent. */
  lootStaffSharePct: integer('loot_staff_share_pct').notNull().default(15),
  /** Admin grants above this many points need a second admin to approve. */
  adminGrantApprovalThreshold: integer('admin_grant_approval_threshold').notNull().default(500),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Accounts & characters
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    /**
     * The matching row in Supabase's `auth.users`. Credentials live entirely in
     * Supabase Auth: this table never stores a password or a password hash.
     */
    supabaseUserId: uuid('supabase_user_id').notNull(),
    role: userRoleEnum('role').notNull().default('MEMBER'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    /** Logical deactivation toggle, independent of a punitive ban. */
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Set when access is permanently removed. The row survives for auditing. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: uuid('deleted_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    uniqueIndex('users_supabase_user_id_key').on(t.supabaseUserId),
    index('users_guild_idx').on(t.guildId),
    index('users_status_idx').on(t.status),
  ],
)

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** lower(name); the uniqueness key, so "Rafa" and "rafa" cannot coexist. */
    nameNormalized: text('name_normalized').notNull(),
    race: raceEnum('race').notNull(),
    /** Free text validated against the biosuits catalogue at write time. */
    biosuit: text('biosuit').notNull(),
    level: integer('level').notNull().default(1),
    kind: characterKindEnum('kind').notNull().default('MAIN'),
    /** In-game combat power, self-reported. Drives the Mega/Titan tiers. */
    combatPower: integer('combat_power').notNull().default(0),
    /** Build checklist shown on the classes board. */
    skill4: boolean('skill_4').notNull().default(false),
    skill5: boolean('skill_5').notNull().default(false),
    skill6: boolean('skill_6').notNull().default(false),
    skill7: boolean('skill_7').notNull().default(false),
    constant3: boolean('constant_3').notNull().default(false),
    painAdaptation: boolean('pain_adaptation').notNull().default(false),
    trinity: boolean('trinity').notNull().default(false),
    techniqueMaster: boolean('technique_master').notNull().default(false),
    /** Set on ALTs: the MAIN character of the same account they roll up to. */
    mainCharacterId: uuid('main_character_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('characters_guild_name_key').on(t.guildId, t.nameNormalized),
    // At most one MAIN per account: the rule that makes "mains only" enforceable.
    uniqueIndex('characters_one_main_per_user')
      .on(t.userId)
      .where(sql`${t.kind} = 'MAIN'`),
    index('characters_user_idx').on(t.userId),
    index('characters_guild_idx').on(t.guildId),
  ],
)

/**
 * The only way a guild comes into existence.
 *
 * A guild used to be creatable by anyone who found the URL. Now it takes a
 * single-use link that dies in 24 hours, and the row records who spent it and
 * what it produced - so every guild on the server traces back to an invite and
 * to the account that redeemed it.
 *
 * The token itself is never stored: `token_hash` is a scrypt digest with the
 * server pepper mixed in, and `token_lookup` is a blind index so redemption
 * stays one indexed read.
 */
export const guildInvites = pgTable(
  'guild_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    tokenLookup: text('token_lookup').notNull(),
    /** Last characters of the token, so two live invites can be told apart. */
    tokenHint: text('token_hint').notNull(),
    /** Free text: who asked for it. NULL when minted by the operator CLI. */
    note: text('note'),
    /** NULL when the invite was minted outside the app, before any user existed. */
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    redeemedByUserId: uuid('redeemed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** The guild this invite produced. The permanent link back to the invite. */
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('guild_invites_token_lookup_key').on(t.tokenLookup),
    index('guild_invites_expires_idx').on(t.expiresAt),
    index('guild_invites_redeemed_idx').on(t.redeemedAt),
  ],
)

/**
 * Recruitment links: how somebody joins an existing guild.
 *
 * Separate from `guild_invites` on purpose. That one mints a guild and is a
 * super-admin power; this one adds a member and belongs to the guild's own
 * admins. Confusing the two would mean a leader could create guilds.
 *
 * `max_uses` covers both shapes the recruiter needs: 1 is a link for one named
 * person, N is a link to drop in a Discord channel. `used_count` is bumped
 * inside the same transaction as the account it created, with the row locked,
 * so a link with three seats cannot admit four people.
 */
export const memberInvites = pgTable(
  'member_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenLookup: text('token_lookup').notNull(),
    tokenHint: text('token_hint').notNull(),
    /** Free text for the admin list: which channel, which recruit. */
    note: text('note'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('member_invites_token_lookup_key').on(t.tokenLookup),
    index('member_invites_guild_idx').on(t.guildId),
    index('member_invites_expires_idx').on(t.expiresAt),
  ],
)

/** Who came in through which link. One row per member, per invite. */
export const memberInviteRedemptions = pgTable(
  'member_invite_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inviteId: uuid('invite_id')
      .notNull()
      .references(() => memberInvites.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('member_invite_redemptions_key').on(t.inviteId, t.userId),
    index('member_invite_redemptions_user_idx').on(t.userId),
  ],
)

/** Catalogue of selectable biosuits, so the signup form is not free text. */
export const biosuits = pgTable(
  'biosuits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    race: raceEnum('race').notNull(),
    name: text('name').notNull(),
    minLevel: integer('min_level').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('biosuits_race_name_key').on(t.race, t.name)],
)

/**
 * Punitive or precautionary access limits. A user can carry several; the
 * effective state is the union of the ones that are currently in force.
 */
export const userRestrictions = pgTable(
  'user_restrictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: restrictionTypeEnum('type').notNull(),
    reason: text('reason').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL means permanent. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id'),
    revokeReason: text('revoke_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_restrictions_user_idx').on(t.userId),
    index('user_restrictions_active_idx').on(t.userId, t.type, t.revokedAt),
  ],
)

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Points awarded per confirmed registration. Mutable; changes cascade. */
    pointsValue: integer('points_value').notNull(),
    status: eventStatusEnum('status').notNull().default('OPEN'),

    /** scrypt digest of the join code (peppered). The plaintext is never stored. */
    codeHash: text('code_hash').notNull(),
    /**
     * Deterministic blind index (HMAC of the code under the server pepper). It
     * makes "which event owns this code?" a single indexed lookup instead of a
     * scrypt comparison against every open event, while still being useless to
     * anyone who only has the database.
     */
    codeLookup: text('code_lookup').notNull(),
    /** Last two characters, so an admin can tell two live codes apart. */
    codeHint: text('code_hint').notNull(),
    codeRotatedAt: timestamp('code_rotated_at', { withTimezone: true }).notNull().defaultNow(),

    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    /** Join window end: the TTL the creating admin picked. */
    registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }).notNull(),
    /** Quorum deadline: creation + confirmationWindowHours (48h by default). */
    confirmationDeadline: timestamp('confirmation_deadline', { withTimezone: true }).notNull(),
    minParticipants: integer('min_participants').notNull().default(3),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_guild_status_idx').on(t.guildId, t.status),
    index('events_code_lookup_idx').on(t.codeLookup),
    index('events_registration_closes_idx').on(t.registrationClosesAt),
    index('events_confirmation_deadline_idx').on(t.confirmationDeadline),
  ],
)

export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    status: registrationStatusEnum('status').notNull().default('PENDING'),
    source: registrationSourceEnum('source').notNull().default('SELF_CODE'),
    /** Set only when source = ADMIN_GRANT. */
    grantedByUserId: uuid('granted_by_user_id'),
    /** Character level at registration time, frozen for the audit trail. */
    levelAtRegistration: integer('level_at_registration').notNull(),
    /** SHA-256 of IP and user agent — enough to correlate, not to identify. */
    ipHash: text('ip_hash'),
    userAgentHash: text('user_agent_hash'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One registration per ACCOUNT per event. This is the alt-farming guard:
    // a player cannot claim the same event once per character.
    uniqueIndex('event_registrations_event_user_key').on(t.eventId, t.userId),
    uniqueIndex('event_registrations_event_character_key').on(t.eventId, t.characterId),
    index('event_registrations_user_idx').on(t.userId),
    index('event_registrations_event_idx').on(t.eventId),
  ],
)

// ---------------------------------------------------------------------------
// Point ledger (append-only)
// ---------------------------------------------------------------------------

/**
 * The single source of truth for balances. Rows are never deleted and `amount`
 * is never edited: a correction is a new row carrying the delta. Only `state`
 * transitions (PENDING -> CONFIRMED | REVERSED).
 *
 *   pending   = SUM(amount) WHERE state = 'PENDING'
 *   available = SUM(amount) WHERE state = 'CONFIRMED'   (loot holds included,
 *                                                        stored as negatives)
 */
export const pointLedger = pgTable(
  'point_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    /** The account that owns the balance. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The character that earned it (an ALT rolls up to its account balance). */
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'set null' }),
    kind: ledgerKindEnum('kind').notNull(),
    state: ledgerStateEnum('state').notNull().default('PENDING'),
    /** Signed. Awards are positive, holds and downward corrections negative. */
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }),
  },
  (t) => [
    index('point_ledger_user_state_idx').on(t.userId, t.state),
    index('point_ledger_event_idx').on(t.eventId),
    index('point_ledger_ref_idx').on(t.refType, t.refId),
  ],
)

// ---------------------------------------------------------------------------
// Weeks & attendance
// ---------------------------------------------------------------------------

/**
 * The guild's week counter. Weekly participation is measured from the start
 * of the newest row; an admin opens the next week by inserting one. Rows are
 * never edited, so every past week keeps its boundaries.
 */
export const guildWeeks = pgTable(
  'guild_weeks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    startedByUserId: uuid('started_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('guild_weeks_guild_number_key').on(t.guildId, t.number),
    index('guild_weeks_guild_started_idx').on(t.guildId, t.startedAt),
  ],
)

/**
 * An excused absence: counts `events_excused` of the week's events as
 * attended for participation. It never awards points. Revoked logically so
 * the history of who excused whom survives.
 */
export const attendanceExcuses = pgTable(
  'attendance_excuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    weekId: uuid('week_id')
      .notNull()
      .references(() => guildWeeks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventsExcused: integer('events_excused').notNull(),
    reason: text('reason').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id'),
  },
  (t) => [index('attendance_excuses_week_user_idx').on(t.weekId, t.userId)],
)

// ---------------------------------------------------------------------------
// Loot raffle (paid in POINTS, main characters only)
// ---------------------------------------------------------------------------

/** A published loot banner. At most one is OPEN per guild. */
export const lootBanners = pgTable(
  'loot_banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** NULL means no deadline: bets stay open until an admin closes the banner. */
    closesAt: timestamp('closes_at', { withTimezone: true }),
    status: lootBannerStatusEnum('status').notNull().default('OPEN'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('loot_banners_one_open_per_guild')
      .on(t.guildId)
      .where(sql`${t.status} = 'OPEN'`),
    index('loot_banners_guild_created_idx').on(t.guildId, t.createdAt),
  ],
)

export const lootItems = pgTable(
  'loot_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bannerId: uuid('banner_id')
      .notNull()
      .references(() => lootBanners.id, { onDelete: 'cascade' }),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The most points a single bet on this item may carry. */
    maxPoints: integer('max_points').notNull(),
    restriction: lootRestrictionEnum('restriction').notNull().default('ALL'),
    status: lootItemStatusEnum('status').notNull().default('OPEN'),
    /** Set when a member won. NULL with a staff name means the staff slice won. */
    winnerUserId: uuid('winner_user_id').references(() => users.id, { onDelete: 'set null' }),
    winnerCharacterId: uuid('winner_character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    /** Frozen at draw time so a later rename does not rewrite history. */
    winnerName: text('winner_name'),
    /** Character name of the staff member the staff slice belonged to. */
    staffName: text('staff_name'),
    /** Points the winner paid: the held amount of the winning bet. */
    pointsPaid: integer('points_paid').notNull().default(0),
    /** The wheel as it was drawn, so every viewer replays the same one. */
    drawSlices: jsonb('draw_slices'),
    drawnAt: timestamp('drawn_at', { withTimezone: true }),
    drawnByUserId: uuid('drawn_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('loot_items_banner_idx').on(t.bannerId),
    index('loot_items_guild_drawn_idx').on(t.guildId, t.drawnAt),
  ],
)

export const lootBets = pgTable(
  'loot_bets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => lootItems.id, { onDelete: 'cascade' }),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    points: integer('points').notNull(),
    /** The LOOT_HOLD ledger row that locked these points. */
    holdLedgerId: uuid('hold_ledger_id').notNull(),
    status: lootBetStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    // One live bet per account per item: a second one would be a way to
    // weight the wheel past the per-bet cap.
    uniqueIndex('loot_bets_one_active_per_user')
      .on(t.itemId, t.userId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('loot_bets_item_idx').on(t.itemId),
    index('loot_bets_user_idx').on(t.userId),
  ],
)

// ---------------------------------------------------------------------------
// Meme raffle (no points involved)
// ---------------------------------------------------------------------------

export const memeDraws = pgTable(
  'meme_draws',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    itemName: text('item_name').notNull(),
    winnerCharacterId: uuid('winner_character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    /** Frozen at draw time so a later rename does not rewrite history. */
    winnerName: text('winner_name').notNull(),
    candidateCount: integer('candidate_count').notNull(),
    note: text('note'),
    drawnByUserId: uuid('drawn_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('meme_draws_guild_created_idx').on(t.guildId, t.createdAt)],
)

// ---------------------------------------------------------------------------
// Boss schedule
// ---------------------------------------------------------------------------

/**
 * A respawn schedule shared by several bosses. A boss with a group follows
 * the group's schedule; one without carries its own.
 */
export const bossGroups = pgTable(
  'boss_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    respawnKind: bossRespawnKindEnum('respawn_kind').notNull(),
    intervalHours: integer('interval_hours'),
    anchorAt: timestamp('anchor_at', { withTimezone: true }),
    /** Comma-separated BRT times, e.g. "16:00, 22:30". */
    dailyTimes: text('daily_times'),
    /** Comma-separated weekdays, 0 = Sunday. */
    weekdays: text('weekdays'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('boss_groups_guild_idx').on(t.guildId)],
)

export const bosses = pgTable(
  'bosses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => bossGroups.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    location: text('location').notNull(),
    /** Own schedule, used only when the boss has no group. */
    respawnKind: bossRespawnKindEnum('respawn_kind'),
    intervalHours: integer('interval_hours'),
    anchorAt: timestamp('anchor_at', { withTimezone: true }),
    dailyTimes: text('daily_times'),
    weekdays: text('weekdays'),
    /** Part of this week's rotation: shown on the schedule. */
    inRotation: boolean('in_rotation').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bosses_guild_idx').on(t.guildId), index('bosses_group_idx').on(t.groupId)],
)

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** Append-only trail of every privileged or balance-affecting action. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    /** Redacted snapshots. Never store secrets, codes or password hashes here. */
    before: jsonb('before'),
    after: jsonb('after'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_guild_created_idx').on(t.guildId, t.createdAt),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_actor_idx').on(t.actorUserId),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const guildsRelations = relations(guilds, ({ many, one }) => ({
  users: many(users),
  characters: many(characters),
  events: many(events),
  settings: one(guildSettings, { fields: [guilds.id], references: [guildSettings.guildId] }),
}))

export const usersRelations = relations(users, ({ many, one }) => ({
  guild: one(guilds, { fields: [users.guildId], references: [guilds.id] }),
  characters: many(characters),
  registrations: many(eventRegistrations),
  ledger: many(pointLedger),
  restrictions: many(userRestrictions),
}))

export const charactersRelations = relations(characters, ({ one, many }) => ({
  user: one(users, { fields: [characters.userId], references: [users.id] }),
  guild: one(guilds, { fields: [characters.guildId], references: [guilds.id] }),
  registrations: many(eventRegistrations),
}))

export const eventsRelations = relations(events, ({ one, many }) => ({
  guild: one(guilds, { fields: [events.guildId], references: [guilds.id] }),
  createdBy: one(users, { fields: [events.createdByUserId], references: [users.id] }),
  registrations: many(eventRegistrations),
  ledgerEntries: many(pointLedger),
}))

export const eventRegistrationsRelations = relations(eventRegistrations, ({ one }) => ({
  event: one(events, { fields: [eventRegistrations.eventId], references: [events.id] }),
  user: one(users, { fields: [eventRegistrations.userId], references: [users.id] }),
  character: one(characters, {
    fields: [eventRegistrations.characterId],
    references: [characters.id],
  }),
}))

export const pointLedgerRelations = relations(pointLedger, ({ one }) => ({
  user: one(users, { fields: [pointLedger.userId], references: [users.id] }),
  event: one(events, { fields: [pointLedger.eventId], references: [events.id] }),
}))

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Guild = typeof guilds.$inferSelect
export type GuildSettings = typeof guildSettings.$inferSelect
export type User = typeof users.$inferSelect
export type Character = typeof characters.$inferSelect
export type UserRestriction = typeof userRestrictions.$inferSelect
export type GuildEvent = typeof events.$inferSelect
export type EventRegistration = typeof eventRegistrations.$inferSelect
export type PointLedgerEntry = typeof pointLedger.$inferSelect
export type GuildWeek = typeof guildWeeks.$inferSelect
export type AttendanceExcuse = typeof attendanceExcuses.$inferSelect
export type LootBanner = typeof lootBanners.$inferSelect
export type LootItem = typeof lootItems.$inferSelect
export type LootBet = typeof lootBets.$inferSelect
export type MemeDraw = typeof memeDraws.$inferSelect
export type BossGroup = typeof bossGroups.$inferSelect
export type Boss = typeof bosses.$inferSelect
export type LootRestriction = (typeof lootRestrictionEnum.enumValues)[number]
export type BossRespawnKind = (typeof bossRespawnKindEnum.enumValues)[number]
export type AuditLogEntry = typeof auditLog.$inferSelect
export type GuildInvite = typeof guildInvites.$inferSelect
export type MemberInvite = typeof memberInvites.$inferSelect
export type JoinPolicy = (typeof joinPolicyEnum.enumValues)[number]

export type UserRole = (typeof userRoleEnum.enumValues)[number]
export type UserStatus = (typeof userStatusEnum.enumValues)[number]
export type Race = (typeof raceEnum.enumValues)[number]
export type CharacterKind = (typeof characterKindEnum.enumValues)[number]
export type RestrictionType = (typeof restrictionTypeEnum.enumValues)[number]
