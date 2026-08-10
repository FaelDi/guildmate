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
| `auction_anti_snipe_seconds` | 120 | Closing-window extension on a late bid |
| `join_policy` | `OPEN` | `OPEN` takes public sign-ups; `INVITE_ONLY` requires a recruitment link |

### `users`
An account. Stores **no password**: credentials live in Supabase Auth, referenced by
`supabase_user_id` (unique). `email` is unique case-insensitively.

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
Ban, suspension, or a narrow block (`NO_EVENTS`, `NO_AUCTION`, `NO_MARKET`).
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
`AUCTION_HOLD` (negative), `AUCTION_RELEASE`.

There is deliberately **no cached balance column** on `users`.

### `auctions` / `auction_bids`
Admin-created, paid in points. `auction_bids.hold_ledger_id` links a bid to the
`AUCTION_HOLD` row that locked its points, so an outbid releases exactly what it took.

### `market_listings`
Member-listed items priced in `price_diamonds`. Diamonds are **not** a tracked balance — the
portal is a classifieds board and the trade happens in game.

### `audit_log`
Append-only trail of every privileged or balance-affecting action. `before` / `after` are
JSONB snapshots run through `redact()`.

## Conventions

- Primary keys are `uuid` with `defaultRandom()`.
- Timestamps are `timestamptz`.
- `onDelete: 'restrict'` on anything the ledger or the audit trail references, so history
  cannot be silently rewritten by a cascade.
- Money-like values are `integer`. No floats anywhere in the economy.
