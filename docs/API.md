# API surface

The UI talks to the server through **server actions**, not a REST API. Only two HTTP
routes exist: the cron sweep and the live-draw poll.

Every action returns `ActionResult<T>`:

```ts
{ ok: true, data: T } | { ok: false, code: string, message: string }
```

`runAction` maps an `AppError` to a displayable message and anything unexpected to a generic
one, with the detail logged server-side.

---

## Server actions

### `src/app/actions/auth.ts`

| Action | Auth | Notes |
|---|---|---|
| `signInAction` | public | Calls GoTrue server-side, sets httpOnly cookies. One generic failure message |
| `registerAction` | public, or a recruitment token | Creates the Supabase credential + the domain row + the first character. `guildSlug` is required only without a token: with one the guild comes from the link (a slug sent alongside is ignored), and a seat is spent in the same transaction |
| `createGuildAction` | invite token | Spends a guild invite and creates the guild, its first `LEADER` and that leader's main character. The only path that creates a guild |
| `signOutAction` | session | Revokes the refresh token and clears cookies |

### `src/app/actions/invites.ts`

| Action | Auth | Notes |
|---|---|---|
| `issueInviteAction` | super admin | **Returns the link once.** Only its digest is stored |
| `revokeInviteAction` | super admin | Kills a live invite. A spent one cannot be revoked |

Minting an invite is not a guild-admin power: it creates a guild *outside* any existing one,
so a leader able to do it could spawn guilds forever. The first invite on a fresh database
comes from `npm run invite:new`, which needs database credentials rather than a session.

### `src/app/actions/recruit.ts`

Recruitment into an existing guild. Guild-admin only, always scoped to the caller's own
guild — the guild id is never read from the form.

| Action | Auth | Notes |
|---|---|---|
| `issueMemberInviteAction` | guild admin | **Returns the link once.** 1 seat or many, 1 hour to 30 days |
| `revokeMemberInviteAction` | guild admin | Kills a live link. Seats already spent stay spent |
| `setJoinPolicyAction` | guild admin | Switches the guild between `OPEN` and `INVITE_ONLY` |

### `src/app/actions/characters.ts`

Roster **structure** (create, promote to MAIN, retire) is **owner-only** — admins get no
override, because whoever controls a roster controls where an ALT's points are attributed.
The roster is loaded keyed to `actor.id` and the rules re-assert owner + guild on every row
(`ownsRoster`).

Character **stats** are different: `updateCharacterAction` is owner **or admin of the same
guild** (`evaluateCharacterStatsUpdate`), and only an admin may rename.

| Action | Auth | Notes |
|---|---|---|
| `createCharacterAction` | owner | First character is the MAIN; later ones are ALTs linked to it. Adopts pre-existing unlinked ALTs |
| `updateCharacterAction` | owner or admin | Object input `{ characterId, patch }`: level, combat power, class (biosuit), build flags; name admin-only. `kind` is **not** patchable |
| `setMainCharacterAction` | owner | Promotes an ALT: demotes the old MAIN and relinks the roster in one transaction |
| `retireCharacterAction` | owner | Logical retirement. Refuses the MAIN and refuses the last character |

### `src/app/actions/events.ts`

| Action | Auth | Notes |
|---|---|---|
| `redeemCodeAction` | session | Registers a character with a join code. Rate limited per account |
| `createEventAction` | admin | **Returns the join code once.** It cannot be read back |
| `changeEventPointsAction` | admin | Cascades a delta to every live registration |
| `rotateEventCodeAction` | admin | Invalidates the previous code immediately |
| `cancelEventAction` | admin | `force` required to cancel an already-confirmed event |
| `grantPointsAction` | admin | Manual scoring. Refuses the admin's own account and its alts |

### `src/app/actions/vortex.ts`

The command-center screens. Every action takes a plain object (shape-checked with Zod, a
malformed one is `INVALID_INPUT`) and every id is re-authorized by the service against the
row it loads.

| Action | Auth | Notes |
|---|---|---|
| `advanceWeekAction` | admin | Opens the next week; participation restarts. Refused within 1h of the last one |
| `updateThresholdsAction` | admin | Mega / Titan combat-power rulers. Titan may not exceed Mega |
| `excuseAbsenceAction` | admin | Counts N of this week's events as attended. Never awards points. Not on own account |
| `revokeExcuseAction` | admin | Logical revoke |
| `applyPenaltyAction` | admin | `PENALTY` ledger row, negative, CONFIRMED. Not on own account |
| `reversePenaltyAction` | admin | One `PENALTY_REVERSAL` for exactly the amount, once. Not on own account |
| `createBannerAction` | admin | Loot banner: title, deadline (or none), 1–20 items with cap and tier restriction. One open banner per guild |
| `extendBannerAction` | admin | Adds hours from the later of the deadline and now |
| `closeBannerAction` | admin | Cancels undrawn items and releases every live bet |
| `placeBetAction` | session | Bets with the caller's **MAIN** (never a form-supplied character). Confirmed points only, ≥ min weekly participation, tier restriction, per-item cap. Holds the points. Rate limited |
| `withdrawBetAction` | owner while open, admin until drawn | Releases the hold |
| `drawItemAction` | admin | CSPRNG draw, settles in the same transaction, persists the wheel. Refused to an admin who bet on the item |
| `updateLootNoteAction` | admin | Free-text note on a drawn item |
| `drawMemeAction` | admin | Uniform CSPRNG pick among active mains of the guild. No points |
| `updateMemeNoteAction` / `deleteMemeDrawAction` | admin | Meme history upkeep |
| `saveBossGroupAction` / `deleteBossGroupAction` | admin | Shared respawn schedules |
| `saveBossAction` / `deleteBossAction` | admin | A boss follows its group, or carries its own schedule |
| `setRotationAction` | admin | Replaces this week's rotation with exactly the ids sent |

### `src/app/actions/admin.ts`

| Action | Auth | Notes |
|---|---|---|
| `setMemberActiveAction` | admin | Logical deactivation / reactivation |
| `applyRestrictionAction` | admin | Ban, suspension or a narrow block. `durationDays: 0` = permanent |
| `revokeRestrictionAction` | admin | Lifts the Supabase Auth ban too, if nothing else holds it |
| `revokeAccessAction` | admin | Permanent. Keeps the row so history stays intact |
| `changeRoleAction` | admin | Cannot grant a rank at or above your own |

All admin actions additionally enforce the **rank rule**: strictly lower rank, never self.

---

## HTTP routes

### `GET|POST /api/cron/sweep`

Called by Vercel Cron every 15 minutes. Requires `Authorization: Bearer $CRON_SECRET`,
compared in constant time. **Fails closed**: returns 404 if the secret is unset or wrong, so
an unconfigured deployment is not an open endpoint.

Confirms events at quorum, cancels events that missed the deadline (reversing every point),
and closes elapsed join windows. Idempotent.

```json
{ "ranAt": "...", "durationMs": 412,
  "events": { "scanned": 5, "confirmed": ["..."], "cancelled": ["..."], "closed": [] } }
```

### `GET /api/loot/live`

Authenticated (session cookie). Returns the loot draw that happened in the **caller's own
guild** in the last 45 seconds, with the persisted wheel, so every open screen replays the
same spin. The guild comes from the session, never from the request. `401` without a session.

```json
{ "draw": { "id": "<itemId>", "itemName": "...", "winnerName": "...", "pointsPaid": 12,
            "wheel": { "slices": [{ "kind": "BET", "label": "...", "weight": 0.42 }], "winnerIndex": 0 },
            "drawnAt": "..." } }
```
