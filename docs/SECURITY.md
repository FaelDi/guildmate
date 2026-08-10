# Security model

## Supabase is never reachable from the client

This is the central architectural boundary, and the reason there is **no
`NEXT_PUBLIC_SUPABASE_*` variable anywhere in this repository**.

```
browser ──► our Next.js server ──► Supabase (Postgres / Auth / Storage)
        (cookies, own origin)   (publishable + secret keys, never leave here)
```

| Concern | How it is handled |
|---|---|
| Database | `src/db` imports `server-only`. Queries run in server components, server actions and route handlers. Drizzle over a direct Postgres connection — there is no PostgREST call to proxy. |
| Auth | Sign-in, sign-up and refresh call GoTrue **from our server** (`src/lib/supabase-auth.ts`). The browser receives only httpOnly cookies on our own origin. |
| Storage | `/api/storage/*` streams objects through our origin after checking the caller. |

What this buys: no Supabase key in the browser bundle, the project URL is not discoverable
from the client, tokens are unreadable to page JavaScript (so XSS cannot exfiltrate a
session), and because every sign-in passes through us, our own per-account lockout is
actually enforceable on top of GoTrue's rate limiting.

### Why the storage proxy is deny-by-default

`SUPABASE_SECRET_KEY` (legacy: `SUPABASE_SERVICE_ROLE_KEY`) **bypasses row level security**. A generic pass-through proxy
carrying that key would be strictly worse than letting the browser call Supabase directly:
any signed-in member could read or write any table through it.

So `/api/storage/*` is not a pass-through. It:

- requires an authenticated session;
- accepts only object keys of the exact shape the app writes,
  `guild/<guildId>/user/<ownerId>/<uuid>.<ext>` (`parseObjectKey` rejects traversal,
  absolute paths, doubled separators and any other extension);
- decides authorization **from the key**: reads are scoped to the caller's guild, deletes
  require the uploader or an admin;
- never lets the client choose the key on upload — it is generated inside the caller's own
  namespace;
- sniffs magic bytes rather than trusting the declared content type, and caps size;
- returns 404 rather than 403 for another guild's object, so it is not an existence oracle.

Anything not on that list is not proxied. Domain data goes through server actions, which are
already a server-side boundary.

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
const [listing] = await tx.select().from(marketListings).where(eq(marketListings.id, id))
if (!listing) throw new AppError('NOT_FOUND', 'Listing not found', 404)
unwrap(authorizeResource({
  actor,
  ownerUserId: listing.sellerUserId,
  resourceGuildId: listing.guildId,
}))
```

Ids arriving in a `FormData` are attacker-controlled and re-authorized server-side. Guild
scoping is checked alongside ownership, so an admin of one guild cannot reach another.

**The roster is the one place admins get no override** (`allowAdminOverride: false` in
`src/services/characters.ts`). Which character is the MAIN decides where an ALT's points are
attributed, so an admin able to reshape another member's roster could redirect attribution
without ever writing to the ledger. Moderation acts on the account, not on the roster.

### Privilege escalation

`authorizeModeration` and `authorizeRoleChange` enforce that an admin acts only on a
**strictly lower rank**, never on a peer, never on themselves, and can never grant a rank at
or above their own.

## Anti-fraud controls

| Attack | Control |
|---|---|
| Admin pays themselves | `evaluateAdminGrant` refuses when the target character's **owning account** is the admin's — routing through an alt does not work. A manual award also requires an existing event. |
| Fake event with no attendees | Under `min_participants` by the 48h deadline → cancelled, every point reversed by the cron sweep. |
| One player claiming an event on many alts | Unique index on `(event_id, user_id)` — one registration per **account**. |
| Code shared outside the raid | Admin-chosen lifetime, capped by guild settings; codes can be rotated instantly. |
| Spending points from an event about to be cancelled | Only `CONFIRMED` points are spendable; awards are `PENDING` until quorum. |
| Code brute force | 8 characters from a 32-symbol alphabet, hashed with a server-side pepper, plus per-account rate limiting on redemption. |
| Sniping an auction | `applyAntiSnipe` extends the clock on a late bid. |
| Double-spending points across two bids | Bids write a negative `AUCTION_HOLD` inside a transaction with the auction row locked. |
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

## Known limitations

- **Rate limiting is per serverless instance** (`src/lib/rate-limit.ts`). A burst spread
  across cold starts can exceed the nominal limit. The controls that must hold globally are
  also enforced in the database (the per-account lockout, the per-event unique index). Move
  to Upstash Redis for a hard global limit — it is on the backlog.
- **Row level security is not used.** All access goes through the server, which enforces
  authorization in the service layer. If you ever expose PostgREST to clients, RLS becomes
  mandatory and none of it is written yet.
- **TLS verification must stay on.** `NODE_TLS_REJECT_UNAUTHORIZED=0` anywhere in the
  environment disables certificate checking for every outbound request, making the Supabase
  connection interceptable. `src/lib/runtime-guards.ts` refuses to boot in production when it
  is set, and warns in development — but it cannot protect a process that never imports it,
  such as an ad-hoc script.
- **Cancelling an already-confirmed event can push a balance negative** if the member spent
  the points. This is deliberate — the balance stays honest and bidding is blocked until it
  recovers — and requires an explicit `force` flag.
