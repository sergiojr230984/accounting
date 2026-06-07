# Changelog

All notable changes to La Cuevita Accounting are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — Production hardening

### Added
- Settings page (`/settings`) with company profile + logo upload, sales tax
  rates, and credit-card processing fee.
- Logo, address, email, and phone from settings render on the printed PDF
  and on the public `/pay/[token]` page.
- Optional per-invoice credit-card fee line item, calculated server-side.
- Tax-rate dropdown on invoice line items (replaces free-form decimal input
  when tax rates are configured in Settings).
- `/api/health` liveness probe with database round-trip latency for Better
  Uptime or any HTTP monitor.
- Sentry client + server + edge configs; auto-instrumented errors flow to
  the DSN set in `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
- In-memory sliding-window rate limiter (`lib/rate-limit.ts`) with helper
  `checkRateLimit()` in `lib/api.ts`. Used on auth-adjacent endpoints.
- `requireAuth` + `requireRole(...)` helpers for consistent API guards.
- App version is now read from `package.json` at build time and shown in
  the sidebar footer and `/api/health` payload.

### Changed
- `next.config.ts` now sets `compress: true`, `productionBrowserSourceMaps:
  false`, strips `console.*` (keeps `error` / `warn`) in production,
  removes the `X-Powered-By` header, sets security headers (XFO, XCTO,
  Referrer-Policy, Permissions-Policy), and long-caches hashed static
  assets.
- Sentry wraps the Next config with source maps disabled — server stack
  traces resolve locally, browsers receive no maps.

### Deployment
- Document required env vars in `.env.example`; see `DEPLOYMENT.md` for the
  full Railway / Postgres least-privilege runbook.

## [1.0.0] — Initial release

- Wave-style customer invoicing with inline line items, inline customer
  creation, sticky totals panel, financing (down payment + remaining
  balance), email + payment link, and PDF print.
- Employees, commissions, performance leaderboard.
- Supplier polish (payment terms, default category, bank details).
- White-sidebar + light-canvas redesign with orange brand accents.
