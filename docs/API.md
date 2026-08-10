# API surface

The UI talks to the server through **server actions**, not a REST API. Only three HTTP
routes exist, and two of them are the storage proxy.

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
| `registerAction` | public, or a recruitment token | Creates the Supabase credential + the domain row + the first character. With a token the guild comes from the link, and a seat is spent in the same transaction |
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

Roster self-service. Every one of these is **owner-only** — admins get no override, because
whoever controls a roster controls where an ALT's points are attributed. Two mechanisms
enforce it: the roster is loaded keyed to `actor.id` and the rules re-assert owner + guild on
every row (`ownsRoster`); the single-row update path additionally calls `authorizeResource`
with `allowAdminOverride: false`.

| Action | Auth | Notes |
|---|---|---|
| `createCharacterAction` | owner | First character is the MAIN; later ones are ALTs linked to it. Adopts pre-existing unlinked ALTs |
| `updateCharacterAction` | owner | Name, biosuit and level only. `kind` is **not** patchable here |
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

### `src/app/actions/auctions.ts`

| Action | Auth | Notes |
|---|---|---|
| `placeBidAction` | session | MAIN character only, confirmed points only, row-locked |
| `createAuctionAction` | admin | |
| `cancelAuctionAction` | admin | Releases the outstanding hold |

### `src/app/actions/market.ts`

| Action | Auth | Notes |
|---|---|---|
| `createListingAction` | session | Priced in diamonds |
| `updateListingAction` | owner or admin | Ownership checked in the service |
| `closeListingAction` | owner or admin | `SOLD` or `CANCELLED` |

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
closes elapsed join windows, settles ended auctions, expires stale listings. Idempotent.

```json
{ "ranAt": "...", "durationMs": 412,
  "events": { "scanned": 5, "confirmed": ["..."], "cancelled": ["..."], "closed": [] },
  "auctionsSettled": 1, "listingsExpired": 3 }
```

### `POST /api/storage/upload`

Authenticated. Multipart with a single `file`. PNG/JPEG/WebP only, verified by magic bytes
rather than the declared type, max 4 MB, 20 uploads per hour per member.

The caller **never chooses the object key** — it is generated inside their own namespace.

```json
{ "key": "guild/<guildId>/user/<userId>/<uuid>.png",
  "url": "/api/storage/guild/<guildId>/user/<userId>/<uuid>.png" }
```

### `GET|DELETE /api/storage/<key>`

Authenticated. `GET` is scoped to the caller's guild; `DELETE` requires the uploader or an
admin. A key that is not the exact shape the app writes returns 404, as does another guild's
object — no existence oracle.

See [SECURITY.md](./SECURITY.md) for why this proxy is deny-by-default rather than a
pass-through.
