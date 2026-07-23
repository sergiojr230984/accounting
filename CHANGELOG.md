# Changelog

All notable changes to La Cuevita Accounting are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] — Production remediation pass

A phased audit-and-fix pass: each item below was its own commit with a
dedicated integration test and a full clean suite run before moving to
the next. See `git log` on this range for the individual commit messages,
which go into more detail than fits here.

### Security
- Fixed a stored-XSS hole in file uploads (extension was derived from the
  client-submitted filename, not the actual MIME type).
- Fixed `requireAuth()`/`requireRole()` failing open to ADMIN on certain
  malformed-session paths.
- Removed two unauthenticated admin endpoints (`/api/admin/bootstrap`,
  `/api/admin/reset-admin-password`) that had no legitimate caller.
- Removed an `AUTH_SECRET` length leak from `/api/me`.
- Stopped logging the fallback admin password in plaintext; it's now
  random per boot instead of a hardcoded literal.
- Rate-limited the login route, by IP and by submitted email.
- Fixed a login timing side-channel that revealed whether an email had an
  account (unknown-email and wrong-password now cost the same).
- Added Content-Security-Policy and Strict-Transport-Security headers.
- Patched known-vulnerable dependencies (dompurify/jspdf, opentelemetry).
- `/api/health/full` (the endpoint documented for external uptime
  monitoring) now actually fails its HTTP status on a DB outage, instead
  of always returning 200.
- Deactivating a user now immediately revokes their existing session,
  instead of only blocking their next login.
- Session lifetime is now an explicit 12 hours instead of NextAuth's
  30-day default.

### Authorization
- Added role gating to six previously-unrestricted resources.
- Rebuilt horizontal SALES-to-SALES data isolation (a SALES user could
  see another SALES user's records).
- Added a CSRF Origin/Referer check as defense-in-depth on mutating API
  routes, independent of the session cookie's SameSite attribute.

### Accounting logic
- A customer/supplier invoice with a recorded payment can no longer have
  its line items edited or be deleted outright (financial history, not a
  draft).
- Overpayment is now rejected server-side, both via direct edits and via
  the payment ledger, instead of silently exceeding the invoice total.
- Payment recording and estimate-to-invoice conversion now run inside a
  real transaction with a row lock, closing two live-reproduced races
  (concurrent payments double-counting, concurrent conversion
  double-booking revenue from one estimate).
- Fixed a rounding disagreement between an invoice's stored subtotal and
  the sum of its own line items (each line is now rounded to 2 decimals
  before being summed, not after).
- The invoice PDF's totals (balance due, payment-received figures) now
  use `Decimal` arithmetic instead of raw floats.
- Custom applied-fee amounts are now capped against their configured
  rate and validated against the company's actual configured fees,
  instead of trusting whatever amount the client submitted.

### Database integrity
- Added the `Estimate`/`EstimateItem` tables to `lib/init-db.ts` (the
  app's sole production schema-provisioning mechanism — see
  `DEPLOYMENT.md`). They were fully implemented but never added there,
  so every `/api/estimates` call would have failed on a fresh production
  database.
- Fixed a race in `initializeDatabase()` where a concurrent caller could
  see initialization as "already started" and proceed before schema
  creation had actually finished.

### Performance
- Invoice/estimate next-number generation now computes the next sequence
  via a single SQL aggregate instead of fetching every existing number
  and scanning in JS — this ran on every "new invoice" page load, and
  inside a transaction holding a row lock during estimate conversion.
- The invoice-to-product-catalog auto-save is now batched into one
  existence-check query plus one bulk insert, instead of a sequential
  round trip per line item.

### Refactoring
- Extracted `lib/next-number.ts` and `lib/product-catalog.ts`, removing
  duplication left behind by the performance fixes above.

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
