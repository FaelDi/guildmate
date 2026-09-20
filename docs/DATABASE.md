# Database schema

Source of truth: `src/db/schema.ts`. Generated SQL: `drizzle/`.
After any schema edit run `npm run db:generate` and commit the migration with the change.

## Tables

### `guilds`
The tenant. `slug` is the join identifier members type when registering. Unique on `slug`.

### `guild_settings`
One row per guild. Every anti-fraud threshold is configurable here so the rules can be tuned
without a deploy.

| Column | Default | Meaning |
|---|---|---|
| `min_participants` | 3 | Registrations required for an event to confirm |
| `confirmation_window_hours` | 48 | Hours before an under-quorum event is cancelled |
| `default_code_ttl_minutes` | 60 | Default join-code lifetime (one hour) |
| `max_code_ttl_minutes` | 720 | Cap on the lifetime an admin may pick |
| `max_registrations_per_day` | 12 | Per-account rolling 24h cap |
| `min_level_to_register` | 1 | Minimum character level for events |
| `alt_points_policy` | `CREDIT_MAIN` | Whether ALT points roll up to the MAIN or are refused |
| `admin_grant_approval_threshold` | 500 | Manual awards above this are flagged for a second admin |
| `join_policy` | `OPEN` | `OPEN` takes public sign-ups; `INVITE_ONLY` requires a recruitment link |
| `mega_cp_threshold` | 190000 | Combat power at which a member is **Mega** (gold). 0 switches the tier off |
| `titan_cp_threshold` | 155000 | Combat power at which a member is **Titan** (blue). Never above Mega |
| `loot_min_participation_pct` | 90 | Weekly participation required to bet on loot |
| `loot_staff_share_pct` | 15 | Fixed share of every loot wheel reserved for the staff |

### `users`
An account. Stores **no password**: credentials live in Supabase Auth, referenced by
`supabase_user_id` (unique). `email` is unique case-insensitively.

`approved_at` / `approved_by_user_id`: sign-up is open, so an account with a null
`approved_at` is `PENDING` and has no access until a leader or the super admin approves it.
An account created through an invite link arrives approved (the link is the vouching).

State columns: `role`, `status` (derived cache), `is_active` (logical deactivation),
`deleted_at` (permanent revocation), `failed_login_count` / `locked_until` (lockout).

### `characters`
Owned by a `user`. `kind` is `MAIN` or `ALT`; an ALT points at its MAIN via
`main_character_id`.

Indexes worth knowing:
- `characters_guild_name_key` — unique `(guild_id, name_normalized)`
- `characters_one_main_per_user` — **partial** unique on `user_id` where `kind = 'MAIN'`

### `guild_invites`
The only door a guild comes through. Single use, 24 hours.

| Column | Note |
|---|---|
| `token_hash` | scrypt digest, peppered. The token itself is never stored |
| `token_lookup` | Blind index (HMAC), unique — redemption is one indexed read |
| `token_hint` | Last 6 characters, so two live invites can be told apart in the admin list |
| `created_by_user_id` | NULL when minted by `npm run invite:new`, before any user exists |
| `redeemed_at` / `redeemed_by_user_id` / `guild_id` | The receipt: when it was spent, by whom, and what it produced |
| `revoked_at` / `revoked_by_user_id` | Kills a leaked link that nobody has spent yet |

`redeemed_at` is written in the same transaction as the guild, with the row locked, so the
link cannot be spent twice.

### `member_invites`
Recruitment links for an existing guild. Issued by that guild's admins, never by a member.

| Column | Note |
|---|---|
| `token_hash` / `token_lookup` / `token_hint` | Same scheme as `guild_invites`: peppered digest, blind index, last 6 characters for the list |
| `max_uses` / `used_count` | 1 is a link for one person, N is a link for a channel. The counter moves inside the transaction that creates the account, with the row locked |
| `revoked_at` / `revoked_by_user_id` | Kills a link that leaked |

`grants_role` is `MEMBER` for recruitment links and `LEADER` only on the single-use link a
super admin mints together with a new guild - that is how a new guild gets its first admin.

### `member_invite_redemptions`
Who joined through which link. Unique on `(invite_id, user_id)`.

### `biosuits`
Catalogue of selectable biosuits, so signup is not blind free text. Game content that changes
between updates, hence a table rather than an enum.

Seeded (`npm run db:seed`) with the RF Online Next roster — Arbiter, Demolisher, Dreadnought,
Enforcer, Phantom, Psypher, Punisher, Technician — for **all three races**: RF Next dropped
the race-locked classes of the 2004 game. The rows stay race-scoped anyway, so a guild can
restrict a suit for its own reasons. The canonical list lives in `src/lib/biosuits.ts`, which
the seed and the signup form both read.

### `user_restrictions`
Ban, suspension, or a narrow block (`NO_EVENTS`, `NO_LOOT`).
`expires_at IS NULL` means permanent; `revoked_at` lifts it. A member may carry several; the
effective state is the union of the ones in force.

### `events`
| Column | Note |
|---|---|
| `points_value` | Mutable. A change cascades to everyone registered |
| `code_hash` | scrypt digest of the peppered join code |
| `code_lookup` | HMAC blind index — makes redemption one indexed lookup |
| `code_hint` | Last two characters, so an admin can tell two live codes apart |
| `registration_closes_at` | End of the join window (the TTL the admin chose) |
| `confirmation_deadline` | Creation + `confirmation_window_hours` |
| `min_participants` | Snapshot of the quorum at creation time |

Status: `OPEN` → `PENDING_CONFIRMATION` → `CONFIRMED` | `CANCELLED`.

### `event_registrations`
| Index | Why |
|---|---|
| unique `(event_id, user_id)` | **One registration per account** — the alt-farming guard |
| unique `(event_id, character_id)` | Belt and braces |

`level_at_registration` freezes the level for the audit trail. `ip_hash` / `user_agent_hash`
are truncated SHA-256 fingerprints, never raw values.

### `point_ledger`
**Append-only.** `amount` is never edited, rows are never deleted; only `state` transitions.

```
pending   = SUM(amount) WHERE state = 'PENDING'
available = SUM(amount) WHERE state = 'CONFIRMED'
```

`kind`: `EVENT_AWARD`, `EVENT_ADJUSTMENT`, `EVENT_REVERSAL`, `ADMIN_ADJUSTMENT`,
`LOOT_HOLD` (negative), `LOOT_RELEASE` (the mirror of a hold), `PENALTY` (negative),
`PENALTY_REVERSAL` (the mirror of one penalty, `ref_id` = the penalty row).

There is deliberately **no cached balance column** on `users`.

### `guild_weeks`
The week counter. One row per week, never edited; the newest row is the current week and
participation is measured from its `started_at`. Unique `(guild_id, number)`.

### `attendance_excuses`
An excused absence: `events_excused` of the week's events count as attended for
participation. No points. Revoked logically (`revoked_at`), never deleted.

### `loot_banners` / `loot_items` / `loot_bets`
The loot raffle, paid in points.

- `loot_banners`: at most one `OPEN` per guild (partial unique index
  `loot_banners_one_open_per_guild`). `closes_at IS NULL` means no deadline.
- `loot_items`: `max_points` caps a single bet; `restriction` is `ALL` / `TITAN` / `MEGA`.
  After the draw: `winner_*`, `winner_name` (frozen), `staff_name` when the staff slice won,
  `points_paid`, and `draw_slices` — the wheel exactly as drawn, so every viewer replays it.
- `loot_bets`: `hold_ledger_id` links a bet to the `LOOT_HOLD` row that locked its points.
  `ACTIVE` → `WON` (the hold is the price) or `RELEASED` (a `LOOT_RELEASE` returned it).
  One live bet per account per item (partial unique index `loot_bets_one_active_per_user`).

### `meme_draws`
The points-free meme raffle history. `winner_name` is frozen at draw time.

### `boss_groups` / `bosses`
The boss schedule. A schedule is `INTERVAL` (`interval_hours` from `anchor_at`), `DAILY`
(`daily_times`, BRT, e.g. `16:00, 22:30`) or `WEEKLY` (`daily_times` on `weekdays`,
`0` = Sunday). A boss with a `group_id` follows its group; one without carries its own
fields. `in_rotation` marks this week's targets.

### `characters` (command-center columns)
`combat_power` (drives the Mega / Titan tiers) and the build checklist `skill_4` … `skill_7`,
`constant_3`, `pain_adaptation`, `trinity`, `technique_master`. The class is the existing
`biosuit` column.

### `audit_log`
Append-only trail of every privileged or balance-affecting action. `before` / `after` are
JSONB snapshots run through `redact()`.

## Conventions

- Primary keys are `uuid` with `defaultRandom()`.
- Timestamps are `timestamptz`.
- `onDelete: 'restrict'` on anything the ledger or the audit trail references, so history
  cannot be silently rewritten by a cascade.
- Money-like values are `integer`. No floats anywhere in the economy.
