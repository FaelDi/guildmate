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
  'AUCTION_HOLD',
  'AUCTION_RELEASE',
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
  'NO_AUCTION',
  'NO_MARKET',
])

export const itemRarityEnum = pgEnum('item_rarity', [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
])

export const itemTypeEnum = pgEnum('item_type', [
  'WEAPON',
  'ARMOR',
  'SHIELD',
  'HELMET',
  'GLOVES',
  'BOOTS',
  'ACCESSORY',
  'BIOSUIT',
  'MATERIAL',
  'CONSUMABLE',
  'OTHER',
])

export const listingStatusEnum = pgEnum('listing_status', [
  'ACTIVE',
  'RESERVED',
  'SOLD',
  'CANCELLED',
  'EXPIRED',
])

export const auctionStatusEnum = pgEnum('auction_status', [
  'DRAFT',
  'OPEN',
  'CLOSED',
  'SETTLED',
  'CANCELLED',
])

/** Whether points earned by an ALT are credited to the account or discarded. */
export const altPointsPolicyEnum = pgEnum('alt_points_policy', ['CREDIT_MAIN', 'NO_CREDIT'])

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
  defaultCodeTtlMinutes: integer('default_code_ttl_minutes').notNull().default(30),
  /** Hard cap on the join-code lifetime an admin may pick. */
  maxCodeTtlMinutes: integer('max_code_ttl_minutes').notNull().default(720),
  /** Per-account cap on self-code registrations in a rolling 24h window. */
  maxRegistrationsPerDay: integer('max_registrations_per_day').notNull().default(12),
  /** Minimum character level allowed to register for events. */
  minLevelToRegister: integer('min_level_to_register').notNull().default(1),
  altPointsPolicy: altPointsPolicyEnum('alt_points_policy').notNull().default('CREDIT_MAIN'),
  /** Admin grants above this many points need a second admin to approve. */
  adminGrantApprovalThreshold: integer('admin_grant_approval_threshold').notNull().default(500),
  /** Seconds an auction is extended when a bid lands near the end (anti-sniping). */
  auctionAntiSnipeSeconds: integer('auction_anti_snipe_seconds').notNull().default(120),
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
 *   available = SUM(amount) WHERE state = 'CONFIRMED'   (auction holds included,
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
// Auctions (admin-created, paid in POINTS, main characters only)
// ---------------------------------------------------------------------------

export const auctions = pgTable(
  'auctions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    itemName: text('item_name').notNull(),
    description: text('description'),
    itemType: itemTypeEnum('item_type').notNull().default('OTHER'),
    rarity: itemRarityEnum('rarity').notNull().default('RARE'),
    itemLevel: integer('item_level').notNull().default(1),
    startingBid: integer('starting_bid').notNull(),
    minIncrement: integer('min_increment').notNull().default(1),
    currentBid: integer('current_bid'),
    currentBidderUserId: uuid('current_bidder_user_id'),
    currentBidderCharacterId: uuid('current_bidder_character_id'),
    status: auctionStatusEnum('status').notNull().default('DRAFT'),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auctions_guild_status_idx').on(t.guildId, t.status),
    index('auctions_ends_at_idx').on(t.endsAt),
  ],
)

export const auctionBids = pgTable(
  'auction_bids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    amount: integer('amount').notNull(),
    /** The AUCTION_HOLD ledger row this bid locked, released when outbid. */
    holdLedgerId: uuid('hold_ledger_id'),
    isWinning: boolean('is_winning').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auction_bids_auction_idx').on(t.auctionId, t.amount),
    index('auction_bids_user_idx').on(t.userId),
  ],
)

// ---------------------------------------------------------------------------
// Guild store (player-listed items, priced in DIAMONDS)
// ---------------------------------------------------------------------------

/**
 * Player-to-player classifieds. Priced in diamonds (the in-game currency),
 * deliberately separate from the event point economy: points are earned in the
 * portal and only spendable in admin auctions, diamonds are traded in game.
 */
export const marketListings = pgTable(
  'market_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    sellerUserId: uuid('seller_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sellerCharacterId: uuid('seller_character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    itemName: text('item_name').notNull(),
    itemType: itemTypeEnum('item_type').notNull().default('OTHER'),
    rarity: itemRarityEnum('rarity').notNull().default('COMMON'),
    itemLevel: integer('item_level').notNull().default(1),
    /** Price in diamonds. */
    priceDiamonds: integer('price_diamonds').notNull(),
    quantity: integer('quantity').notNull().default(1),
    notes: text('notes'),
    status: listingStatusEnum('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    soldAt: timestamp('sold_at', { withTimezone: true }),
    soldToCharacterId: uuid('sold_to_character_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('market_listings_guild_status_idx').on(t.guildId, t.status),
    index('market_listings_seller_idx').on(t.sellerUserId),
    index('market_listings_expires_idx').on(t.expiresAt),
  ],
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
  listings: many(marketListings),
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

export const auctionsRelations = relations(auctions, ({ many, one }) => ({
  guild: one(guilds, { fields: [auctions.guildId], references: [guilds.id] }),
  bids: many(auctionBids),
}))

export const auctionBidsRelations = relations(auctionBids, ({ one }) => ({
  auction: one(auctions, { fields: [auctionBids.auctionId], references: [auctions.id] }),
  user: one(users, { fields: [auctionBids.userId], references: [users.id] }),
}))

export const marketListingsRelations = relations(marketListings, ({ one }) => ({
  guild: one(guilds, { fields: [marketListings.guildId], references: [guilds.id] }),
  seller: one(users, { fields: [marketListings.sellerUserId], references: [users.id] }),
  sellerCharacter: one(characters, {
    fields: [marketListings.sellerCharacterId],
    references: [characters.id],
  }),
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
export type Auction = typeof auctions.$inferSelect
export type AuctionBid = typeof auctionBids.$inferSelect
export type MarketListing = typeof marketListings.$inferSelect
export type AuditLogEntry = typeof auditLog.$inferSelect
export type GuildInvite = typeof guildInvites.$inferSelect

export type UserRole = (typeof userRoleEnum.enumValues)[number]
export type UserStatus = (typeof userStatusEnum.enumValues)[number]
export type Race = (typeof raceEnum.enumValues)[number]
export type CharacterKind = (typeof characterKindEnum.enumValues)[number]
export type RestrictionType = (typeof restrictionTypeEnum.enumValues)[number]
export type ItemRarity = (typeof itemRarityEnum.enumValues)[number]
export type ItemType = (typeof itemTypeEnum.enumValues)[number]
