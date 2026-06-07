# Deployment & ops runbook

Production stack: **Next.js 15** on **Railway**, **Postgres** add-on,
**Sentry** for errors, **Better Uptime** for liveness pings.

## 1. Railway service settings

1. **Source**: GitHub → `sergiojr230984/accounting`, branch
   `claude/accounting-system-issue-P9dod` (until merged to `main`).
2. **Build command** (set in `railway.json`):
   `npm ci && npm run build`
3. **Start command** (set in `railway.json`): `npm start`
4. **Pre-Deploy Command**: **must be empty**. Schema is created/migrated
   idempotently by `lib/init-db.ts` at first request. Leaving `prisma db
   push` or `prisma migrate deploy` in pre-deploy will hang the deploy.
5. **Health check path**: `/api/health` (returns 200 + version + DB
   latency, 503 if the DB is unreachable).
6. **Restart policy**: `ON_FAILURE`.

## 2. Environment variables

Copy `.env.example` into Railway → Variables and fill in the production
values. The bare minimum to boot:

- `DATABASE_URL` — auto-attached by the Postgres add-on.
- `AUTH_SECRET` — `openssl rand -base64 32`.

Recommended adds:

- `APP_URL` — your public Railway domain so payment links resolve.
- `ANTHROPIC_API_KEY` — enables PDF-to-form AI extraction.
- `RESEND_API_KEY` + `EMAIL_FROM` — enables the Email Invoice button.
- `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — server + client error capture.

## 3. Database security (least-privilege grants)

Railway provisions a Postgres role with full DB ownership. Treat that
role as your **migration role**. Create a separate **app role** with
narrower grants so a SQL-injection or compromised SDK key cannot drop
the schema:

```sql
-- Run once as the owner role (do this via Railway Data tab).
CREATE ROLE accounting_app LOGIN PASSWORD 'pick-a-strong-password';

GRANT CONNECT ON DATABASE railway TO accounting_app;
GRANT USAGE ON SCHEMA public TO accounting_app;

-- App-readable + writable tables (everything the app reads/writes):
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO accounting_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO accounting_app;

-- Lock future tables to the same grants so additions don't reset privileges:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO accounting_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO accounting_app;

-- Optional: deny DDL by NOT granting CREATE on schema public.
-- (Postgres revokes it by default for non-owners.)
```

Once the role exists, switch `DATABASE_URL` over to it. Keep the
owner-role connection string in a separate variable (e.g.
`DATABASE_MIGRATION_URL`) and only use it if you need to alter schema
manually outside of `init-db.ts`.

## 4. API-level authorization

Every API route uses `lib/api.ts` helpers:

- `requireAuth()` — 401 if no session, else returns the session.
- `requireRole("ADMIN")` — 403 if the user isn't in the allowed roles.
- `checkRateLimit(request, key, { windowMs, max })` — 429 with
  `Retry-After` if the per-IP bucket overflows.

Sensitive routes (settings, employee CRUD, invoice delete) are gated to
`ADMIN`; transactional routes (invoice create/edit, customer/supplier
CRUD) are gated to `ADMIN` or `MANAGER`; read endpoints accept any
authenticated user.

## 5. Monitoring

### Sentry

1. Create a Next.js project at sentry.io. Copy the DSN.
2. Set `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser)
   in Railway. Set `SENTRY_ORG` + `SENTRY_PROJECT` for the build
   wrapper.
3. Server errors auto-flow via `instrumentation.ts` →
   `onRequestError` → `Sentry.captureRequestError`. Client errors flow
   via `sentry.client.config.ts`.

### Better Uptime

1. Create a free account.
2. Add a monitor: HTTP, URL `https://<your-domain>/api/health`,
   expected status `200`, check every 1 min.
3. The endpoint returns 503 when the DB is unreachable, so an outage
   triggers immediately.

## 6. Caching

- Hashed static assets under `/_next/static/*` are sent with
  `Cache-Control: public, max-age=31536000, immutable` via Next config
  headers.
- HTML and API routes default to no caching unless the route explicitly
  sets `Cache-Control` or uses `revalidate`.
- Client-side data is fetched on demand. If a screen needs SWR-style
  caching, wrap fetchers in TanStack Query (already installed).

## 7. Source maps

Server bundles include source maps locally so stack traces resolve
inside Sentry; **client bundles do not ship source maps** —
`productionBrowserSourceMaps: false` and `hideSourceMaps: true` in the
Sentry wrapper guarantee this.

## 8. Releases

- Bump `package.json#version` per [semver](https://semver.org).
- Add an entry to `CHANGELOG.md`.
- Tag the release: `git tag v$(jq -r .version package.json) && git push --tags`.
- The current version is rendered in the sidebar footer and in the
  `/api/health` payload so you can verify what's deployed.

## 9. Rate limiting upgrade path

`lib/rate-limit.ts` is in-memory and works for a **single replica**.
If you scale Railway to N replicas, swap it for Upstash Redis:

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "1 m"),
});
```

The `checkRateLimit()` helper in `lib/api.ts` is the only call site,
so the swap is a one-file change.
