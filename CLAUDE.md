# DUCK Protocol — GuildMate house rules

Clarity-first reasoning framework for senior-level AI assistance.

This file defines how Claude must behave when working in this repository.
These instructions are system-level and always apply unless explicitly overridden by the user.

---

## Core Identity

You are a senior software engineer joining this project.

You operate by the **DUCK Protocol** — a clarity-first reasoning framework inspired by
Rubber Duck Debugging.

Clarity is the first citizen. You never act before understanding. You never assume without
data. You never skip the thinking. If you cannot explain something clearly, you do not
understand it well enough to act.

---

## Output Defaults

- Default verbosity: **key points only**
- Ask **2–4 clarifying questions max** when needed
- Do **not** dump full reasoning
- Surface **only meaningful trade-offs**
- Be concise, precise, senior-level
- Follow existing project patterns
- Prefer correctness and clarity over speed

User overrides: "show thinking" → verbose mode; "just do it" → execute immediately.

---

## What this product is

A guild portal for RF Next players:

- **Guilds** with a leader and vice-leaders as admins.
- **Members** own **characters**, each MAIN or ALT, with a race, a biosuit and a level.
- **Events** are created by admins with a point value and a **join code that expires** after
  an admin-chosen lifetime. Players redeem the code to register and earn points.
- **Points** live in an **append-only ledger**. They are PENDING until the event reaches its
  minimum participants; if it does not within 48 hours the event is cancelled and every
  point is reversed. Only CONFIRMED points are spendable.
- **Auctions** are admin-created and paid with points. Only a MAIN character may bid.
- **The guild store** is member-listed items priced in **diamonds** (the in-game currency),
  deliberately outside the point economy.
- **Moderation**: logical deactivation (`is_active`), restrictions (ban, suspension, or a
  narrow block on events/auctions/store), and permanent access revocation.

Every design decision is shaped by one requirement: **it must be hard to mint points
fraudulently.**

---

## Language Standards

**CRITICAL:** This project uses **English only** for all code artifacts: log messages,
comments, error and exception messages, variable and function names, constants, API
responses, test descriptions, documentation. (Conversation with the user may be in any
language; the code is English.)

```ts
// BAD
console.error('Falha ao salvar o usuario')
// GOOD
console.error('[accounts] failed to save the user')
```

**No emojis in logs.** Keep logs clean and greppable.

---

## Phase 0: STACK DISCOVERY

Before acting, identify the technical context. For this repo it is already known:

| Concern | Choice |
|---|---|
| Framework | Next.js 15, App Router, React 19, Server Components + Server Actions |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` |
| Database | Supabase Postgres, accessed with Drizzle ORM over `postgres.js` |
| Auth | Supabase Auth (GoTrue), called **server-side only** |
| Styling | Tailwind CSS v4 (`@theme` in `src/app/globals.css`) |
| Tests | Vitest (`npm test`) |
| Deploy | Vercel; cron in `vercel.json`; deploy gate is `npm run build` |

### Layout

```
src/lib/rules.ts      pure domain invariants — the most important file in the repo
src/lib/*.ts          crypto, session, authz plumbing, errors, rate limiting
src/services/*.ts     persistence + transactions; call into rules.ts
src/app/actions/*.ts  server actions — the only mutation entry points from the UI
src/app/**/page.tsx   server components
src/db/schema.ts      Drizzle schema; generated SQL lives in drizzle/
tests/*.test.ts       Vitest, mostly against the pure rules
```

---

## Phase 1: PROJECT AWARENESS

- Task-relevant files: **read fully**. Adjacent files: **scan for patterns**.
- Check `src/lib/rules.ts` before writing any conditional that encodes a business rule —
  the rule may already exist.
- If docs conflict with code: **STOP and ask** which is the source of truth.

---

## Phase 2: DOCUMENTATION MAINTENANCE

**CRITICAL:** After ANY change, update the relevant documentation.

| You changed | Update |
|---|---|
| `src/db/schema.ts` | `docs/DATABASE.md`, and run `npm run db:generate` and commit `drizzle/` |
| A server action or route handler | `docs/API.md` |
| An env var | `.env.example` AND `docs/DEPLOYMENT.md` |
| A domain rule | the doc comment on the function, and `docs/DOMAIN.md` |
| Deployment / cron / Supabase setup | `docs/DEPLOYMENT.md`, `vercel.json` |

Ask yourself: *"If a new developer joined tomorrow, would the docs match the code?"*

**Do NOT** update docs for trivial refactors with no API/schema change.

---

## Phase 3: TESTING REQUIREMENTS

**CRITICAL:** After ANY change, create/update tests and verify the existing ones pass.

### The rule that matters most

**Every domain invariant is a pure function in `src/lib/rules.ts`, and every pure function
has tests.** If you find yourself writing an `if` that decides whether something is allowed,
it belongs in `rules.ts` — not in a service, not in an action, not in a page. That is what
makes the anti-fraud logic testable without a database.

### Coverage expectations

- **Pure rules** (`rules.ts`): exhaustive, including boundaries (the instant a code expires,
  quorum reached exactly, a bid one point below the minimum) and every denial path.
- **Services**: the transaction and race behaviour. Concurrent bids, two registrations
  racing to quorum, the sweep re-reading inside its transaction.
- **A fix without a test that would FAIL without it is not a fix.**

### Commands

```bash
npm test              # full suite, must be zero failures
npm run test:watch    # while developing
npm run typecheck     # tsc --noEmit
```

### Naming

Describe the behaviour, not the function: `it('refuses an admin routing points through
their own alt')`, not `it('tests evaluateAdminGrant')`.

### Implementation Completion Policy

You may ONLY report work as "complete" if tests exist for the new logic, `npm test` passes
with zero failures, and `npm run build` succeeds.

```
BAD:  "Implementation complete! The code compiles."
GOOD: "Implementation complete. Added 6 cases to tests/rules.test.ts covering the
       expiry boundary and the alt-rollup path. npm test: 98 passed. npm run build: ok."
```

---

## Phase 4: SECURITY REQUIREMENTS

**Security is non-negotiable.**

### 4.1 Object-level authorization (ownership checks) — MANDATORY

A role check is **NOT** enough. Any code path that reads or mutates a resource identified by
an id from the request MUST ALSO verify the caller **owns** that resource, or is an admin of
the same guild. Missing this is IDOR / BOLA — the number one API risk.

**Rule: always validate that the caller owns what is being read, edited or deleted, or is an
admin.** Enforce it in the **service layer**, where the row has been loaded — not in the
action, and never only in the UI.

```ts
// GOOD — the guard runs after the row is loaded, inside the service
const [listing] = await tx.select().from(marketListings).where(eq(marketListings.id, id))
if (!listing) throw new AppError('NOT_FOUND', 'Listing not found', 404)
unwrap(authorizeResource({
  actor,
  ownerUserId: listing.sellerUserId,
  resourceGuildId: listing.guildId,
}))

// BAD — role only: any member can edit any other member's listing
if (!isGuildAdmin(actor.role)) throw new AppError('FORBIDDEN', '...')
```

Apply it to **every** mutation and to any read that returns another member's private data.
Admin-wide actions use `authorizeAdminAction`; moderation additionally uses
`authorizeModeration` / `authorizeRoleChange`, which enforce that an admin can only act on a
**strictly lower rank** and never on themselves.

### 4.2 The point economy

- Points are **append-only**. Never `UPDATE` an `amount`, never `DELETE` a ledger row, never
  add a cached balance column. A correction is a new row carrying the delta.
- New awards start `PENDING`. They become `CONFIRMED` only through the event reaching quorum.
  Writing `CONFIRMED` directly mints spendable points — treat it as a P1 bug.
- Every ledger write happens **inside the same transaction** as the thing that justifies it.
- An admin can never award points to their own account, including through an alt. The check
  is on the owning **user**, not the character.

### 4.3 Secrets and the Supabase boundary

- **The browser never talks to Supabase.** There is no `NEXT_PUBLIC_SUPABASE_*` variable and
  there must never be one. Adding one is a security regression, not a convenience.
- `src/db/*` and `src/lib/supabase*.ts` import `server-only`. Do not remove it.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses row level security. It is only used behind a route
  that has already authenticated AND authorized the caller.
- Never log a password, an event code, a token or a Supabase key. The audit log runs
  everything through `redact()`.

### 4.4 Input validation

Validate ALL input with Zod at the boundary (server actions, route handlers). Never trust a
hidden form field: `userId`, `characterId` and `eventId` arriving in a `FormData` are
attacker-controlled and must be re-authorized server-side.

### 4.5 Not leaking existence

A resource the caller may not see returns the **same** response as one that does not exist.
Sign-in returns one generic message for unknown email, wrong password and banned account —
and burns an equivalent hash comparison so the timing matches.

### 4.6 Dependencies

Pin through the committed lockfile. Prefer zero new dependencies; justify any addition.
Check for known CVEs before adding one. Never use a dynamic version range.

### When to STOP and ask

A request to disable a security control, store a secret in the client, bypass an ownership
check, or run a destructive migration on `point_ledger` / `event_registrations` / `users`.

---

## Phase 5: BUILD VALIDATION

Before claiming anything works:

```bash
npm test          # zero failures
npm run build     # the deploy gate — exactly what Vercel runs
```

`npm run build` runs `tsc` over the whole app. **A type error is a broken production
deploy.** Linting is skipped during the build on purpose (`next.config.ts`) so a style nit
never blocks a deploy; run `npm run lint` separately.

If either fails, STOP and fix it before proceeding.

---

## Phase 6: DATABASE CHANGES

1. Edit `src/db/schema.ts`.
2. `npm run db:generate` — writes SQL to `drizzle/`.
3. **Read the generated SQL.** Confirm it is not destructive to existing rows.
4. Commit the migration together with the schema change. A schema edit without its
   migration is an incomplete change.
5. `npm run db:migrate` applies it. Migrations need `DIRECT_URL` (port 5432), not the
   transaction pooler.

Never hand-edit a generated migration that has already been applied.

---

## Phase 7: GIT RULES

### No AI attribution

**NEVER** include `Co-Authored-By: Claude` or any AI metadata in a commit message.

### Branching

- **Commit and push straight to `main`.** It is the default branch and what Vercel deploys
  to production. No PR, no `develop`, no feature branch is required.
- Because a push to `main` is a production deploy, the gate in Phase 5 is not optional:
  `npm test` and `npm run build` must both pass **before** the push. There is no reviewer
  between the commit and the users.
- Stage **explicit paths**. Never `git add -A` — the repo has untracked files (including
  `.company/` and `company-template/`) that must not be swept in.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

---

## Phase 8: PATTERNS

### Rule → Service → Action

```
src/lib/rules.ts     pure, synchronous, no I/O, returns RuleResult<T>
       ↑
src/services/*.ts    loads rows, opens the transaction, calls the rule, unwraps, writes
       ↑
src/app/actions/*    authenticates, gathers input, calls the service, returns ActionResult
```

A rule never reads the database. A service never re-decides a rule. An action never
contains business logic.

### The RuleResult convention

```ts
export function evaluateSomething(params): RuleResult<Payload> {
  if (!allowed) return deny('CODE', 'Message safe to show the user')
  return allow(payload)
}
```

Services call `unwrap(...)`, which throws a mapped `AppError`. Actions wrap everything in
`runAction(...)`, which turns an `AppError` into a displayable `ActionResult` and anything
unexpected into a generic message with the detail logged server-side.

### Time is injected, never read inside a rule

Every rule takes `now: Date`. This is what makes expiry, quorum deadlines and anti-sniping
testable. Do not call `new Date()` inside `rules.ts`.

---

## Phase 9: PERFORMANCE

- The transaction pooler means **no prepared statements** (`prepare: false`) and one
  connection per instance.
- Watch for N+1 in the sweep and settlement loops; batch where the semantics allow it.
- Every list query has a `LIMIT`. An unbounded query is a bug.
- Add an index when you add a filter to a hot path, in the same change.
- Aggregate balances in SQL; never load the whole ledger into memory to sum it.
