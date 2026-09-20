# Security model

## Supabase is never reachable from the client

This is the central architectural boundary, and the reason there is **no
`NEXT_PUBLIC_SUPABASE_*` variable anywhere in this repository**.

```
browser ──► our Next.js server ──► Supabase (Postgres / Auth)
        (cookies, own origin)   (publishable + secret keys, never leave here)
```

| Concern | How it is handled |
|---|---|
| Database | `src/db` imports `server-only`. Queries run in server components, server actions and route handlers. Drizzle over a direct Postgres connection — there is no PostgREST call to proxy. |
| Auth | Sign-in, sign-up and refresh call GoTrue **from our server** (`src/lib/supabase-auth.ts`). The browser receives only httpOnly cookies on our own origin. |

What this buys: no Supabase key in the browser bundle, the project URL is not discoverable
from the client, tokens are unreadable to page JavaScript (so XSS cannot exfiltrate a
session), and because every sign-in passes through us, our own per-account lockout is
actually enforceable on top of GoTrue's rate limiting.

### No pass-through proxy

`SUPABASE_SECRET_KEY` (legacy: `SUPABASE_SERVICE_ROLE_KEY`) **bypasses row level security**. A
generic pass-through carrying that key would be strictly worse than letting the browser call
Supabase directly, so there is none: domain data goes through server actions, and the only
routes are the fail-closed cron sweep and `/api/loot/live`, which reads the caller's own
guild from the session. (The item-screenshot storage proxy left with the guild store.)

### Google Translate

The language selector loads Google's translate script **only after a visitor picks a
language other than Portuguese**. It then rewrites the rendered page in the browser, so the
text on screen reaches Google. It cannot read the session: both auth cookies are httpOnly.
A visitor who never picks another language never loads the script.

## Authorization

Two layers, both mandatory:

1. **Authentication** — a Supabase access token, cryptographically verified (`jose`,
   signature + expiry + issuer). Decoding without verifying would let anyone mint an admin
   session.
2. **Authorization** — read from the **live database row** on every request, never from the
   token. `getSessionContext()` loads `users` and its restrictions and runs
   `evaluateAccountAccess`. That is what makes a ban or a demotion take effect on the next
   request instead of at token expiry.

### Object-level authorization (OWASP API1 — BOLA/IDOR)

A role check is never enough. Every read or mutation of a member-owned row calls
`authorizeResource` in the **service layer**, after the row is loaded:

```ts
const [bet] = await tx.select().from(lootBets).where(eq(lootBets.id, betId)).limit(1).for('update')
if (!bet || bet.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
unwrap(evaluateBetWithdrawal({ actor, bet, item, banner, now })) // authorizeResource inside
```

Ids arriving in a `FormData` are attacker-controlled and re-authorized server-side. Guild
scoping is checked alongside ownership, so an admin of one guild cannot reach another.

**The roster structure is the one place admins get no override**: creating, promoting and
retiring characters is owner-only (`ownsRoster` in the rules). Which character is the MAIN
decides where an ALT's points are attributed, so an admin able to reshape another member's
roster could redirect attribution without ever writing to the ledger. Character **stats**
(level, combat power, class, build) are owner-or-admin, and only an admin renames
(`evaluateCharacterStatsUpdate`).

### The board is public, acting is not

The ranking, builds, loot log, meme history and boss schedule render for anyone. What a
visitor never receives is the roster's own detail - alts, level, combat power, class and
build - which is **withheld server-side**, not hidden with CSS: the page sends `details:
null` and the HTML simply has no such value. Everything that changes state still goes
through a server action that re-checks the session.

### Sign-up is open, membership is not

Anyone can create an account; it has no access until a leader or the super admin approves it
(`evaluateApproval`). This is what stops people who do not play with the guild from reading
members-only numbers by simply registering. Approval is refused on one's own account, and a
sign-up that came through an admin's link is approved on the spot.

### Privilege escalation

`authorizeModeration` and `authorizeRoleChange` enforce that an admin acts only on a
**strictly lower rank**, never on a peer, never on themselves, and can never grant a rank at
or above their own.

A **leader link** (`member_invites.grants_role = 'LEADER'`) hands out the LEADER role, so
only a super admin may issue one, it admits exactly one person, and it is only ever minted
together with the new guild it belongs to.

## Anti-fraud controls

| Attack | Control |
|---|---|
| Admin pays themselves | `evaluateAdminGrant` refuses when the target character's **owning account** is the admin's — routing through an alt does not work. A manual award also requires an existing event. |
| Fake event with no attendees | Under `min_participants` by the 48h deadline → cancelled, every point reversed by the cron sweep. |
| One player claiming an event on many alts | Unique index on `(event_id, user_id)` — one registration per **account**. |
| Code shared outside the raid | Admin-chosen lifetime, capped by guild settings; codes can be rotated instantly. |
| Spending points from an event about to be cancelled | Only `CONFIRMED` points are spendable; awards are `PENDING` until quorum. |
| Code brute force | 8 characters from a 32-symbol alphabet, hashed with a server-side pepper, plus per-account rate limiting on redemption. |
| Double-spending points across two loot bets | The bettor's own `users` row is locked **first**, then the item: the same balance cannot fund two simultaneous bets on different items. A partial unique index allows one live bet per account per item. |
| Re-rolling a loot draw | The CSPRNG roll and the settlement happen in one transaction; the wheel is persisted. There is no endpoint that accepts a client-side result. |
| Admin drawing an item they bet on | `evaluateLootDraw` refuses; another admin must draw it. |
| Admin excusing or un-penalizing themselves | `evaluateExcuse` and `evaluatePenaltyReversal` refuse the admin's own account; a penalty is reversible exactly once, for exactly its amount. |
| Inflating combat power to unlock Mega items | Self-reported and visible to the whole guild on two boards; any admin can correct it, and every edit is audited. |
| Admin invents an event and pays himself | Two controls, because there are two doors: `evaluateRegistration` refuses the event's creator, and `resolveEventQuorum` makes the guild quorum a floor so a quorum of 1 cannot be set. |
| Strangers reading members-only data | Sign-up is open but approval-gated, and the public board withholds the roster's detail server-side. |
| Colluding accounts | IP and user-agent fingerprints (hashed, never raw) recorded per registration and surfaced in the admin log. |

## Credentials and secrets

- Passwords live in Supabase Auth. This database stores **no password and no password
  hash** — only `supabase_user_id`.
- Event codes are stored as a scrypt digest plus a peppered HMAC blind index. The plaintext
  is shown once and cannot be recovered.
- `redact()` strips passwords, codes, tokens and keys before anything is written to the
  audit log.
- IPs and user agents are stored only as truncated SHA-256 fingerprints.

## Not leaking existence

- Sign-in returns one generic message for unknown email, wrong password and banned account —
  and burns an equivalent hash comparison so the timing matches.
- A resource the caller may not see returns the same response as one that does not exist.
- A wrong event code and an expired one are reported identically.

## Transport to the database

`postgres.js` defaults to **no TLS**, and Supabase's pooler accepts a plaintext connection —
so the default shipped every query and the database password unencrypted. The client now sets
`ssl: 'require'`, which encrypts without pinning a CA: enough against passive interception,
not against an active man in the middle.

For the stronger setting, download Supabase's CA bundle, point `NODE_EXTRA_CA_CERTS` at it
and change `ssl` to `{ rejectUnauthorized: true }` in `src/db/index.ts`.

## Known limitations

- **Rate limiting is per serverless instance** (`src/lib/rate-limit.ts`). A burst spread
  across cold starts can exceed the nominal limit. The controls that must hold globally are
  also enforced in the database (the per-account lockout, the per-event unique index). Move
  to Upstash Redis for a hard global limit — it is on the backlog.
- **Combat power is self-reported.** It gates the Mega/Titan loot tiers, so a member can
  claim a tier they have not reached. The control is social and after the fact: the value
  is public on the ranking and classes boards, admins can correct it, and the audit log
  records every edit.
- **Row level security is not used.** All access goes through the server, which enforces
  authorization in the service layer. If you ever expose PostgREST to clients, RLS becomes
  mandatory and none of it is written yet.
- **TLS verification must stay on.** `NODE_TLS_REJECT_UNAUTHORIZED=0` anywhere in the
  environment disables certificate checking for every outbound request, making the Supabase
  connection interceptable. `src/lib/runtime-guards.ts` refuses to boot in production when it
  is set, and warns in development — but it cannot protect a process that never imports it,
  such as an ad-hoc script.
- **A banned member can sign up again with another address.** Moderation binds to the
  `users` row, and there is no proof of identity beyond an email that registration
  auto-confirms. Sign-up is rate limited per address, which slows it but does not stop it.
  Real mitigation is email confirmation (needs SMTP configured in Supabase) or an
  invite-only join policy, which this app supports per guild.
- **Emails are not verified.** `adminCreateUser` passes `email_confirm: true`, so an address
  is taken on trust. Turning confirmation on without working SMTP would lock everybody out,
  so it stays a deliberate deployment decision.
- **Cancelling an already-confirmed event can push a balance negative** if the member spent
  the points. This is deliberate — the balance stays honest and betting is blocked until it
  recovers — and requires an explicit `force` flag.
