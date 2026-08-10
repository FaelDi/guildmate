# Deployment — Supabase + Vercel

## 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. **Project Settings → Database → Connection string** gives you two URLs:
   - **Transaction pooler**, port `6543` → `DATABASE_URL` (what the app uses at runtime;
     serverless functions are short lived and this is what survives that).
   - **Session / direct**, port `5432` → `DIRECT_URL` (what migrations use; DDL does not
     work over the transaction pooler).
3. **Project Settings → API Keys** gives the project URL and the two keys.
   Current projects issue `sb_publishable_...` and `sb_secret_...`; older ones issue the
   legacy `anon` / `service_role` JWTs. Both naming schemes are accepted
   (`SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`, falling back to
   `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`).
4. **JWT signing keys.** Current projects sign access tokens asymmetrically (ES256) and
   publish them via JWKS — leave `SUPABASE_JWT_SECRET` **empty**; verification uses JWKS
   automatically. Only a legacy project on symmetric signing needs that variable, and
   setting it on an ES256 project would force the wrong verification path.
5. **Authentication → Providers → Email**: enable it. Since accounts are created through the
   admin API with `email_confirm: true`, you can leave confirmations off initially.

## 2. Environment variables

Copy `.env.example` to `.env.local` for development, and set the same keys in
**Vercel → Project Settings → Environment Variables** for Preview and Production.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Runtime connection (transaction pooler, port 6543) |
| `DIRECT_URL` | Migrations (direct, port 5432) |
| `SUPABASE_URL` | Project URL, used server-side for Auth and Storage |
| `SUPABASE_PUBLISHABLE_KEY` | Public GoTrue endpoints, called from our server |
| `SUPABASE_SECRET_KEY` | Admin API and Storage. **Bypasses RLS.** Server only |
| `SUPABASE_JWKS_URL` | Optional. Defaults to `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_SECRET` | Optional. **Leave empty** unless the project signs JWTs symmetrically |
| `SUPABASE_STORAGE_BUCKET` | Bucket for item screenshots |
| `CRON_SECRET` | Bearer token Vercel Cron sends. `openssl rand -hex 32` |
| `EVENT_CODE_PEPPER` | Mixed into event code hashes. `openssl rand -hex 32` |

> **No variable is prefixed `NEXT_PUBLIC_`, and none should be.** The browser never talks to
> Supabase — see [SECURITY.md](./SECURITY.md).

> **Rotating `EVENT_CODE_PEPPER` invalidates every live event code.** Do it only when no
> event is open.

> **Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.** It disables TLS certificate verification
> for every outbound request, which makes the Supabase connection interceptable. The app
> refuses to start in production when it is set (`src/lib/runtime-guards.ts`) and warns in
> development. If a corporate proxy needs a custom CA, use `NODE_EXTRA_CA_CERTS` instead.

## 3. Apply the schema

```bash
npm install
npm run db:generate     # only after editing src/db/schema.ts
npm run db:migrate      # applies drizzle/*.sql using DIRECT_URL
```

drizzle-kit runs outside Next, so `drizzle.config.ts` loads `.env.local` itself (through
`@next/env`, the same loader the app uses, so a migration can never target a different
database than the running app). `DIRECT_URL` must be the **direct** connection: DDL does not
work over the transaction pooler.

Note that `SUPABASE_URL` is the HTTPS API endpoint for Auth and Storage — it is **not** a
database connection. The Postgres URLs come from **Connect → ORMs** in the dashboard and
authenticate with the database password, not with an API key.

**No direct database access?** Paste `scripts/supabase-bootstrap.sql` into the Supabase SQL
Editor instead. It carries the initial schema, the biosuit catalogue and the row that marks
`0000_init` as applied, so a later `npm run db:migrate` picks up from the right place. It is
frozen at `0000_init` — every migration after that still goes through drizzle-kit.

For a throwaway environment `npm run db:push` syncs the schema without a migration file.
Never use `db:push` against production.

## 4. Create the storage bucket (optional)

Only needed if you enable item screenshots. In **Storage**, create a bucket matching
`SUPABASE_STORAGE_BUCKET` and leave it **private** — the app streams objects through
`/api/storage/*` after checking the caller, so public access would defeat the proxy.

## 5. Deploy to Vercel

```bash
vercel link
vercel --prod
```

- Build command: `npm run build` (the deploy gate).
- Region is pinned to `gru1` in `vercel.json`; move it closer to your Supabase region if
  that is not São Paulo.
- The cron in `vercel.json` calls `/api/cron/sweep` every 15 minutes. Vercel sends
  `Authorization: Bearer $CRON_SECRET`; the route **fails closed** and returns 404 if the
  secret is unset or wrong, so an unconfigured deployment is not an open endpoint.

> Cron frequency below once per day requires a paid Vercel plan. On Hobby, change the
> schedule to `0 * * * *` or trigger the endpoint from an external scheduler with the same
> bearer token.

## 6. What the sweep does

Every run: confirms events that reached quorum, cancels events that missed it past the
deadline (reversing every point), closes join windows that elapsed, settles ended auctions,
and expires stale store listings. It is idempotent — running it twice changes nothing the
second time.

Verify it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/sweep
```

## 7. Branches

`main` is the only branch. It is the repository default and Vercel's production branch, and
it is pushed to directly — every push deploys.

That makes `npm test` and `npm run build` the release process, not a formality: nothing sits
between a commit and the guild using it. Any other branch you push builds a Vercel preview
and deploys nothing.

## 8. Rollback

Vercel keeps every deployment. To stop a bad release immediately, promote the previous
deployment from the dashboard, then fix the branch. A schema migration is **not** rolled
back by that — write a forward migration.
