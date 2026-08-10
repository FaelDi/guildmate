# GuildMate

A guild portal for RF Next players: guild and character registry, live events scored with a
time-limited join code, an append-only point ledger, admin point auctions, and a player item
store priced in diamonds.

The whole design answers one requirement: **it must be hard to mint points fraudulently.**

## What it does

- **Guilds** with a leader and vice-leaders as admins.
- **Members** own characters, each MAIN or ALT, with a race, a biosuit and a level.
- **Events** carry a point value and a join code that expires after an admin-chosen
  lifetime. Players redeem the code to register and earn points.
- **Points** are PENDING until the event reaches its minimum participants. If fewer than
  three register within 48 hours the event is cancelled and every point is reversed.
- **Auctions** are admin-created and paid with confirmed points. Only a MAIN character bids.
- **The store** is member-listed gear priced in diamonds, deliberately outside the point
  economy.
- **Moderation**: logical deactivation, timed or permanent restrictions, and permanent
  access revocation — all mirrored into Supabase Auth.

## Stack

Next.js 15 (App Router, React 19) · TypeScript strict · Drizzle ORM on Supabase Postgres ·
Supabase Auth called server-side only · Tailwind v4 · Vitest · Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the Supabase values
npm run db:migrate             # apply the schema (uses DIRECT_URL)
npm run db:seed                # biosuit catalogue
npm run dev
```

Open <http://localhost:3000> and use **Create a guild** to make the first leader account.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Vitest suite |
| `npm run build` | Production build — **this is the deploy gate** |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |

## Architecture

```
src/lib/rules.ts      pure domain invariants — the most important file in the repo
src/services/*.ts     persistence + transactions; call into rules.ts
src/app/actions/*.ts  server actions — the only mutation entry points
src/db/schema.ts      Drizzle schema; generated SQL in drizzle/
tests/*.test.ts       Vitest against the pure rules
```

A rule never reads the database. A service never re-decides a rule. An action never contains
business logic. That separation is what makes the anti-fraud logic testable without a
database — and it is why `tests/rules.test.ts` can cover every denial path.

## Documentation

| Document | Contents |
|---|---|
| [docs/DOMAIN.md](./docs/DOMAIN.md) | The model and every anti-fraud rule |
| [docs/DATABASE.md](./docs/DATABASE.md) | Schema, indexes and conventions |
| [docs/API.md](./docs/API.md) | Server actions and the three HTTP routes |
| [docs/SECURITY.md](./docs/SECURITY.md) | Authorization, the Supabase boundary, known limitations |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Supabase + Vercel setup |
| [CLAUDE.md](./CLAUDE.md) | House rules for anyone (human or agent) changing this code |

## Two things to know before changing anything

1. **The browser never talks to Supabase.** There is no `NEXT_PUBLIC_SUPABASE_*` variable
   and there must never be one. See [docs/SECURITY.md](./docs/SECURITY.md).
2. **Points are append-only.** No cached balance column, no `UPDATE` on an amount. A
   correction is a new row carrying the delta.
