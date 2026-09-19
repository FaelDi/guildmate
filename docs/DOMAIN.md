# Domain model and anti-fraud rules

Every rule below is implemented as a pure function in `src/lib/rules.ts` and covered by
`tests/rules.test.ts` and `tests/vortex-rules.test.ts`. Services call those functions;
nothing re-implements them.

---

## Guilds are created from an invite

A guild exists only because somebody spent an invite. There is no other code path that
inserts into `guilds`.

| Rule | Function | Denial |
|---|---|---|
| The link dies 24 hours after it is issued | `resolveInviteExpiry` | `INVITE_EXPIRED` |
| One link, one guild | `evaluateInviteRedemption` | `INVITE_USED` |
| A leaked link can be killed before anyone spends it | `evaluateInviteRedemption` | `INVITE_REVOKED` |
| Only a super admin issues one | `authorizeInviteIssue` | `FORBIDDEN` |
| Somebody already in a guild cannot redeem | `evaluateInviteRedemption` | `ALREADY_IN_GUILD` |

That last rule is a schema fact, not a policy preference: an account belongs to exactly one
guild (`users.guild_id`), and its characters, points and history are scoped to that guild.
Letting a signed-in member redeem would have to move their account and strand all of it, so
redemption is for a brand-new account — the guild, the leader and their main character are
created in one transaction, or not at all.

The token is never stored. `token_hash` is a scrypt digest with the server pepper mixed in
and `token_lookup` is a blind index, so redemption is one indexed read and a database dump
does not yield a working link. The row keeps the receipt: who issued it, who spent it, and
which guild it produced.

The invite is marked spent **inside the same transaction as the guild**, with the row locked,
so two people opening the same link at the same moment cannot produce two guilds.

---

## Joining a guild

A guild decides for itself who gets in, through `guild_settings.join_policy`:

| Policy | What it means |
|---|---|
| `OPEN` (default) | Anyone finds the guild in the public directory and signs up |
| `INVITE_ONLY` | The guild stays listed, but only a recruitment link admits somebody |

A recruitment link is issued by a **guild admin** — unlike a guild invite, which mints a whole
new guild and is a super-admin power. Confusing the two would let a leader spawn guilds.

| Rule | Function | Denial |
|---|---|---|
| A closed guild needs a link | `evaluateJoin` | `INVITE_REQUIRED` |
| A link only works for the guild it was issued for | `evaluateJoin` | `INVITE_INVALID` |
| A link stops at its seat count | `evaluateJoin` | `INVITE_EXHAUSTED` |
| Expired or revoked links are dead | `evaluateJoin` | `INVITE_EXPIRED`, `INVITE_REVOKED` |
| 1 to 100 seats, 1 hour to 30 days | `evaluateMemberInviteIssue` | `INVALID_USES`, `INVALID_TTL` |
| Only a guild admin issues one | `evaluateMemberInviteIssue` | `FORBIDDEN` |

`max_uses` covers both shapes recruitment needs: **1** is a link for one named person, **N**
is a link to drop in a Discord channel. `used_count` is incremented in the same transaction
as the account it created, with the row locked, so a link with three seats cannot admit four
people — and `member_invite_redemptions` records who came in through which link.

A link overrides the guild picker entirely: the guild id comes from the invite, never from
the form, so a token for guild A cannot be used to walk into guild B.

---

## Accounts and characters

An **account** (`users`) holds credentials (in Supabase Auth), a role and a state. It owns
one or more **characters** (`characters`), each MAIN or ALT with a race, a biosuit and a
level.

- At most **one MAIN per account**, enforced by a partial unique index.
- An ALT points at its MAIN through `main_character_id`.
- Character names are unique per guild, case-insensitively.
- The biosuit is validated for length, not against a whitelist: the roster is game content
  (`src/lib/biosuits.ts` carries the eight RF Online Next suits as suggestions), and a private
  server may run suits Netmarble never shipped.

### Managing the roster

Members manage their own roster from `/profile`; **admins have no override on its
structure** (create, promote, retire). Which character is the MAIN decides where an ALT's
points are attributed, so an admin able to reshape someone else's roster could redirect
attribution without ever touching the ledger. Stats and build are the exception: an admin may
correct level, combat power, class, build and name for anybody in the guild (see *Combat
power, class and build*).

| Rule | Function | Denial |
|---|---|---|
| An ALT may only exist once a MAIN does, and is created already linked to it | `evaluateCharacterCreate` | `MAIN_REQUIRED` |
| A second MAIN is refused, retired ones included — they still hold the index slot | `evaluateCharacterCreate` | `MAIN_ALREADY_EXISTS` |
| Creating the MAIN **adopts** the ALTs that predate it (sign-up allows an ALT first) | `evaluateCharacterCreate` | — |
| At most 10 characters per account **ever**, retired ones included | `evaluateCharacterCreate` | `ROSTER_FULL` |
| `kind` is not editable; promotion is its own audited step | `evaluateCharacterStatsUpdate` | — |
| Promoting an ALT demotes the old MAIN and relinks every other ALT, in one transaction | `evaluateMainSwitch` | `ALREADY_MAIN`, `CHARACTER_INACTIVE` |
| A MAIN is never retirable directly — promote a successor first | `evaluateCharacterRetire` | `MAIN_CANNOT_RETIRE` |
| An account always keeps at least one live character | `evaluateCharacterRetire` | `LAST_CHARACTER` |

Together these keep the invariant the rollup depends on: **every account has exactly one MAIN,
and every ALT points at it.** Retirement is logical (`is_active = false`), so the ledger and
the audit trail stay intact. Promotion never moves points: the ledger is append-only and
balances are keyed by account.

The cap counts retired characters too. `characters_guild_name_key` has no `is_active`
predicate, so a retired character keeps holding its guild-wide name; if retirement freed a
slot, a create-and-retire loop could reserve every name in the guild.

### Roles

| Role | Rank | Can |
|---|---|---|
| `MEMBER` | 0 | register for events, bid, list items |
| `VICE_LEADER` | 1 | everything above + admin actions |
| `LEADER` | 2 | everything above |
| `SUPER_ADMIN` | 3 | everything above |

**Moderation is only ever downward.** An admin may act on a strictly lower rank, never on a
peer, never on themselves, and may never grant a rank at or above their own
(`authorizeModeration`, `authorizeRoleChange`). Without this a vice-leader could ban the
leader or promote an ally to their own level.

### Account state

Three independent mechanisms, deliberately not collapsed into one flag:

| Mechanism | Column / table | Meaning | Reversible |
|---|---|---|---|
| Logical deactivation | `users.is_active` | Not punitive. No sign-in, history kept. | Yes |
| Restriction | `user_restrictions` | `BAN`, `SUSPENSION`, or a narrow `NO_EVENTS` / `NO_LOOT` block. Timed or permanent. | Yes, by revoking |
| Permanent revocation | `users.deleted_at` | Access removed for good. The row survives so the ledger and audit trail stay intact. | No |

`users.status` is a **derived cache** of the above (`deriveUserStatus`). Access is decided
by `evaluateAccountAccess` from the live restrictions, so a lapsed ban lets the member back
in even if the column has not been reconciled yet. Bans and suspensions are also mirrored
into Supabase Auth, so the credential itself stops issuing tokens.

---

## Events

An admin creates an event with a point value, a **join code**, a code lifetime and a
minimum participant count.

### The code

- Generated from an alphabet with no `O/0/I/1`, so it survives being read aloud in voice chat.
- Stored **only** as a scrypt digest plus a peppered HMAC blind index (`code_lookup`) that
  makes redemption a single indexed lookup instead of a scrypt comparison against every open
  event. The plaintext is shown once, at creation, and can never be read back.
- Lives until `registration_closes_at`, which the admin chooses and the guild settings cap.
- Can be rotated, which invalidates the previous code immediately.

### Lifecycle

```
OPEN ──quorum reached──────────────────► CONFIRMED   (points become spendable)
  │
  ├──code lifetime elapsed──► PENDING_CONFIRMATION
  │                                │
  └────────────────────────────────┴──deadline passed, still short──► CANCELLED
                                                                       (all points reversed)
```

`resolveEventSweep` decides which transition applies. Note the ordering: quorum wins over
the deadline, so an event that reaches its third registration at the last second confirms
rather than cancelling.

### The anti-fraud rule

> If fewer than 3 people register within 48 hours, the event is cancelled and everyone's
> points are removed.

Both numbers are per-guild settings (`min_participants`, `confirmation_window_hours`). The
scheduled sweep (`/api/cron/sweep`, every 15 minutes) applies it. This is why a lone admin
cannot invent an event and quietly pay themselves.

### Registration preconditions

`evaluateRegistration` refuses when: the account is banned, suspended, inactive or blocked
from events; the character is not owned by the caller, is inactive, or belongs to another
guild; the event is not `OPEN`, has not started, or the code has expired; the **account**
already registered for this event; the character is below the minimum level; the account is
over its rolling 24h registration cap; or the character is an ALT in a guild whose policy is
`NO_CREDIT`.

The uniqueness constraint is on `(event_id, user_id)`, not `(event_id, character_id)` — one
registration **per account**, so a player cannot claim the same event once per alt.

### An admin cannot pay themselves

Two doors write an `EVENT_AWARD`, and both are shut:

| Door | Control |
|---|---|
| Manual grant | `evaluateAdminGrant` refuses when the target character's owning **account** is the admin's, so an alt does not help |
| Redeeming a code | `evaluateRegistration` refuses when the character's account created the event — the creator is handed the plaintext code and nobody else need ever see it |

And the quorum an admin picks is bounded from below: `resolveEventQuorum` treats
`guild_settings.min_participants` as a **floor**, not a default. Without that, an admin could
set a quorum of 1 and confirm an event alone.

### Manual scoring by an admin

`evaluateAdminGrant` additionally requires:

- an **existing event** — points cannot be minted from nothing;
- the target is **not the admin's own account**, checked on the owning user so routing the
  award through an alt does not work;
- awards above `admin_grant_approval_threshold` are flagged `needsSecondApproval`.

---

## The point ledger

`point_ledger` is **append-only**. `amount` is never edited and rows are never deleted; only
`state` transitions.

```
pending   = SUM(amount) WHERE state = 'PENDING'
available = SUM(amount) WHERE state = 'CONFIRMED'
```

| Kind | When | Sign |
|---|---|---|
| `EVENT_AWARD` | a registration | + |
| `EVENT_ADJUSTMENT` | the event was re-scored | ± |
| `ADMIN_ADJUSTMENT` | a manual correction | ± |
| `LOOT_HOLD` | a loot bet locks points | − |
| `LOOT_RELEASE` | the bet lost, was withdrawn, or the banner closed | + |
| `PENALTY` | an admin deducts points | − |
| `PENALTY_REVERSAL` | one penalty undone, once, for exactly its amount | + |

There is deliberately **no cached balance column**. A reversal cannot leave a stale total
behind if there is no total to go stale.

### Re-scoring an event

When an admin changes an event from 100 to 150 points, `planPointsChange` emits **one +50
delta row per live registration**, inheriting each registration's state. That is what
"update everyone who registered" means without ever rewriting history. `REVERSED`
registrations are skipped.

A downward change can push a balance negative if the member already committed the points to
a loot bet. That is intentional: the balance stays honest and `evaluateLootBet` simply
refuses new bets until it recovers.

### Alt rollup

Points earned by an ALT are credited to the account and attributed to its MAIN character, so
the ranking and the loot eligibility check agree. A guild can switch this off with
`alt_points_policy = 'NO_CREDIT'`, which blocks ALTs from registering at all.

The rollup is only as good as the link: an ALT with a null `main_character_id` falls back to
crediting itself. That is why the roster rules above refuse to create an unlinked ALT and why
creating a MAIN adopts the ones that predate it.

---

## Weeks and participation

The guild runs in weeks (`guild_weeks`). An admin opens the next one (`evaluateWeekAdvance`,
refused within an hour of the last so a double click cannot burn a week).

**Weekly participation** (`computeParticipation`) = (events attended + events excused) /
events held this week, capped at 100%, one decimal. Events the member **created** are not
counted against them — a creator can never redeem their own code. A week with no events is
100%. Cancelled events and reversed registrations do not count.

An **excused absence** (`evaluateExcuse`) credits N events as attended for this week. It
never awards points. It is an admin power and **never on the admin's own account**: it raises
participation, and participation is the gate to loot bets.

## Penalties

A **penalty** (`evaluatePenalty`) is a `PENALTY` ledger row, negative and CONFIRMED. A
**reversal** (`evaluatePenaltyReversal`) credits exactly what one penalty took, exactly once
(the penalty row is locked while the reversal is checked), and never to the admin doing it —
otherwise "penalize, then reverse twice" would mint. Neither is allowed on one's own account.

## Combat power, class and build

Each character carries a self-reported `combat_power`, a class (the `biosuit` column) and a
build checklist. **Only the owner or an admin of the same guild edits them**
(`evaluateCharacterStatsUpdate`); **only an admin renames**. None of these touch the ledger,
but combat power decides the loot tiers:

| Tier | Rule (`classifyCombatPower`) |
|---|---|
| Mega | `combat_power >= mega_cp_threshold` |
| Titan | `combat_power >= titan_cp_threshold` |

A threshold of 0 switches that tier off; Titan may never be set above Mega
(`evaluateThresholdUpdate`).

## The loot raffle (points)

An admin publishes a **banner** (`evaluateLootBannerCreate`): a title, a deadline (or none)
and 1–20 items, each with a per-bet cap and a tier restriction (`ALL`, `TITAN`+ or `MEGA`).
One open banner per guild.

A **bet** (`evaluateLootBet`) is refused unless every one of these holds:

- the account may act and is not under `NO_LOOT`;
- it is placed with the caller's **MAIN** — the service picks it, the form never names a
  character;
- the banner is open and its deadline has not arrived (the instant it arrives, bets stop);
- the item is still open and in the caller's guild and banner;
- weekly participation ≥ `loot_min_participation_pct` (90% by default);
- the caller's tier meets the item restriction;
- no other live bet by this account on this item;
- a positive whole number, at most the item cap, at most the **confirmed** balance.

The bet writes a `LOOT_HOLD` for the negative amount inside the same transaction, with the
bettor's `users` row locked first, so the same points can never back two bets. Withdrawing
(`evaluateBetWithdrawal`: owner while bets are open, an admin until the draw) writes the
mirror `LOOT_RELEASE`.

**The wheel** (`buildLootWheel`): the chosen staff member gets a fixed
`loot_staff_share_pct` (15%) slice; the rest is split between the bets in proportion to their
points, however few points are on the table. With no staff picked, the bettors share 100%.

**The draw** (`evaluateLootDraw`, `pickWheelSlice`): admin only, never by an admin who bet on
the item, and the staff slice must belong to an admin of the guild. The roll comes from the
CSPRNG on the server and the whole draw settles in one transaction — the winner's hold stays
(that is the price, **only the winner pays**), every other bet is released — so there is no
"spin again". The wheel is persisted on the item, and every open screen replays the same
spin through `/api/loot/live`.

Closing a banner cancels every undrawn item and releases all of its bets. Permanently
revoking a member releases their live bets.

## The meme raffle

Points-free. An admin picks active mains of the guild (`evaluateMemeDraw`); the server picks
one uniformly with the CSPRNG (`pickUniformIndex`). History can be annotated or deleted.

## Boss schedule

Reference data, admin-edited. Every spawn time is computed by `nextSpawn` in **BRT (UTC−3,
no daylight saving)**: an `INTERVAL` boss rolls its anchor forward by whole cycles (a boss
spawning exactly now is a full cycle away); `DAILY` takes the next of its times today or
tomorrow; `WEEKLY` the next listed weekday and time. `validateBossSchedule` normalises input
and drops fields a kind does not use. A boss in a group follows the group
(`resolveBossSchedule`). The schedule page counts down on the client from the same function.

---

## Audit

`audit_log` is append-only and records every privileged or balance-affecting action, with a
before/after snapshot run through `redact()` so no code, token or hash is ever written to it.
