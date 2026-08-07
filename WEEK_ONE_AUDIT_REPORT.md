# Week-One Operational Audit — La Cuevita Accounting System

**Audit date:** 2026-08-07
**Auditor:** Claude Code (automated code + local-environment audit)
**Scope of this pass:** Full source-code inspection (`sergiojr230984/accounting` @ `82245e2`) plus hands-on testing against a **local, throwaway PostgreSQL instance** seeded with the repo's own fixture data. **No production database, production logs, or production environment variables were accessed** — see "Access Limitations" below. All findings below are either (a) confirmed by reading the source, (b) confirmed by reproducing the behavior locally, or (c) explicitly marked as an assumption requiring production verification.

---

## Executive Summary

This is a Next.js 15 / PostgreSQL / Prisma accounting application (invoices, bills, customers, suppliers, payments — **no estimates/quotes module exists**, despite the audit brief assuming a Wave-Accounting-style estimate workflow). The codebase shows a consistent pattern: **several major features are wired up on the frontend and in the database schema, but their backend implementation was never finished or was later deleted**, and the build is configured to hide this instead of surfacing it.

Concretely, three of the most safety-critical subsystems are non-functional right now:

1. **Payments cannot be recorded through the intended workflow.** The invoice detail page's "Add/Edit/Delete Payment" forms call `POST/PATCH/DELETE /api/invoices/customer/{id}/payments...`, but no such API route exists anywhere in the repo. I reproduced this live: the call returns **HTTP 404**. Every attempted payment-recording action in production for the last week has been failing.
2. **All audit logging is silently broken.** `lib/audit.ts` calls `prisma.auditLog.create(...)` and several admin routes call `prisma.auditLog.findMany(...)`, but the `AuditLog` model does not exist in `prisma/schema.prisma` — it was dropped in merge commit `5a82fb0` and never restored, even though a follow-up commit (`3db8a2d`, "feat: RBAC, Audit Log, Automated Backups, 1099 Contractor Tracking") built an entire admin UI around it. I reproduced this: a freshly-pushed DB from the current schema has **no `AuditLog` table at all**, and every write throws (caught silently). **There is no audit trail for anything that happened this week** — no record of who created, edited, deleted, or paid any invoice.
3. **The build is shipping with known type errors deliberately suppressed.** `next.config.ts` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`, with a comment admitting routes reference "Prisma models and fields that are planned but not yet in the schema." I ran `npx tsc --noEmit` and confirmed **32 real compile errors** across 6 files (audit log, backups, 1099/Supplier fields). This is a known, acknowledged defect that was papered over rather than fixed before going live.

On top of this, a **hardcoded backdoor-like privilege-escalation routine** runs on every server boot (`lib/init-db.ts`, invoked from `instrumentation.ts`): it force-promotes `admin@lacuevita.com` to ADMIN unconditionally, and if no ADMIN user exists at all, it **silently (re-)creates one with the password `admin123`, hardcoded in source**. Combined with `prisma/seed.ts` shipping the same default admin/manager credentials, this is the single highest-priority item in this report — see Risk Register R-1 and R-2.

There is also a live, unauthenticated (`/api/debug`) and a login-gated-but-unauthorized (`/api/test-db`) diagnostic endpoint in production that leak database host/port/name and full table schemas, and the latter performs a live write (create+delete) against the production `Customer` table on every call.

None of these are edge cases — they sit directly on the money path (payments, audit trail, admin access) and were confirmed either by static analysis or by live reproduction in a local test environment.

## System Overview

See the companion architecture summary in the chat response for the full system map. Quick reference:

- **Frontend/Backend:** Next.js 15 (App Router), React 18, Tailwind — a single monolith, API routes under `app/api/**`.
- **Database:** PostgreSQL via Prisma ORM 5.22 (`prisma/schema.prisma`). Decimal money fields use `decimal.js` in application code, which is correct practice.
- **Auth:** NextAuth v5 (beta) with credentials provider, bcrypt password hashing, JWT sessions, custom RBAC (`ADMIN`/`MANAGER`/`SALES`) enforced ad hoc per-route.
- **Hosting:** Railway (Nixpacks build). `railway.json` build/start commands and `railway.toml` healthcheck **disagree with each other** (`/` vs `/api/health`).
- **PDF:** `jspdf` + `jspdf-autotable`, generated client-side.
- **Email:** `nodemailer` configured via SMTP env vars — but no working "send invoice" route was found (see below).
- **File storage:** local filesystem (`public/uploads`), optional S3-compatible upload for backups only.
- **AI:** Anthropic SDK used for OCR-style invoice data extraction (`/api/invoices/extract`) — not used for anything financial/authoritative.
- **Schema-management is triple-sourced and drifting:** (1) `prisma/schema.prisma` + `prisma migrate`/`db push`, (2) a hand-written 40+ statement raw-SQL bootstrap in `lib/init-db.ts` run on every boot via `instrumentation.ts`, and (3) the Railway start command itself running `npx prisma db push --accept-data-loss` on every restart. These three do not agree on what columns/tables should exist (confirmed: `AuditLog`/`BackupLog`/several 1099 Supplier fields are absent from all three).

## Usage Statistics (Phase 2)

**Blocked — no production data access in this session.** I cannot report login counts, per-employee activity, invoice/estimate counts, or overdue balances without a read-only connection to the production database or exported logs. See "Access Limitations."

What I *can* say from the code: there is no login-failure tracking, no rate limiting, and no session-anomaly detection anywhere in the codebase, so even once granted access, "failed login attempts" and "activity outside business hours" cannot currently be reconstructed from application data — only from infrastructure-level logs (Railway logs), if retained.

## Financial Discrepancies

Full detail in `ACCOUNTING_RECONCILIATION.md`. Headline finding, reproduced live against a local test database seeded from the repo's own `prisma/seed.ts`:

- Line/tax/total math is correct for a standard case (3 × $19.99 @ 8.25% tax → subtotal $59.97, tax $4.95, total $64.92 — verified by hand and via `decimal.js`).
- **`PATCH /api/invoices/customer/{id}` accepts a `paidAmount` far exceeding the invoice total with no validation.** I set `paidAmount` to `500.00` on a $64.92 invoice; the API returned `200 OK`, `paymentStatus: "PAID"`, no error. This is the exact "payments greater than invoice balance" defect the audit brief asked me to check for — confirmed real.
- Invoice numbers are **not** enforced server-side: `invoiceNumber` is a free-text field on both create and update, uniqueness is only scoped `(invoiceNumber, customerId)` — not global — and the "next number" endpoint computes `MAX(...)+1` from existing rows via string parsing instead of using the atomic `CompanyProfile.customerInvoiceNextSeq` counter that already exists in the schema for this exact purpose (and is never referenced anywhere in the code). This is a race condition and a duplicate/gap risk, not just a theoretical one.

## Security Findings

Full detail and severity ranking in `RISK_REGISTER.md`. Headlines:

- **Hardcoded default admin credentials, self-healing on every boot** (`lib/init-db.ts` + `prisma/seed.ts`) — `admin@lacuevita.com` / `admin123`.
- **`/api/debug`** — fully public, no auth, leaks DB host/port/name, env, whether `AUTH_SECRET` is configured and its length, raw DB connection error text.
- **`/api/test-db`** — reachable by any logged-in user (no role check, no `auth()` call at all), leaks full `Customer`/`Supplier` column lists, and executes a live create+delete against the production `Customer` table on every GET request.
- **No rate limiting anywhere** in the codebase — login brute-forcing is unmitigated.
- **No MFA.**
- File upload validation trusts the client-supplied MIME type and the client-supplied filename/extension independently — a mismatched pair (e.g., declare `image/png`, name the file `.html`) is stored and served statically from `public/uploads`, a plausible stored-XSS vector.
- Middleware (`middleware.ts`) only checks **presence** of a session cookie, not its validity — real authorization is delegated entirely to each route calling `auth()`, and at least one route (`/api/test-db`) doesn't.

## Workflow Failures (Phase 4)

Tested against a local instance (see `TEST_RESULTS.md` for full transcript):

| # | Workflow | Result |
|---|---|---|
| 1 | Create customer | ✅ Pass |
| 2–4 | Estimate create/edit/convert | ❌ N/A — no Estimate feature exists in this app at all |
| 5 | Create invoice with items + tax | ✅ Pass — math correct |
| 6 | Generate PDF | Not exercised this pass (client-side jsPDF, low risk, not time-permitting) |
| 7 | Send document by email | ❌ **Broken** — no `/api/invoices/customer/{id}/send` route exists; frontend button will 404 |
| 8–10 | Record partial → final payment → balance zero | ❌ **Broken** — no payments API route exists (404, reproduced live) |
| 11 | Void/cancel a document | ❌ **Not implemented** — only hard `DELETE` exists; no void action, no reason capture |
| 12 | Refund/credit | ❌ **Not implemented** — no refund concept in the schema or API at all |
| 13 | Search customer/document | Not exercised this pass |
| 15 | Concurrent edits by two users | ❌ **No protection** — no version/optimistic-lock field on `CustomerInvoice`; last write silently wins |
| 18 | Overpayment / invalid values | ❌ **Fails safe check** — $500 payment accepted on a $64.92 invoice, reproduced live |

## Data-Quality Issues

- `CustomerInvoice.invoiceNumber` uniqueness is per-customer, not global — duplicate invoice numbers across different customers are allowed by design.
- No soft-delete anywhere (`onDelete: Cascade` on line items) — deleting an invoice is permanent and, combined with the audit-log outage, leaves **zero trace**.
- `lib/init-db.ts` runs an unlogged bulk `UPDATE "CustomerInvoice" SET "paymentStatus" = ...` reconciliation pass on **every server boot**, silently correcting any invoice whose stored status doesn't match its computed status — with no record of which rows changed or what they changed from/to.
- A stray `Product` catalog record is auto-created any time an invoice line-item description doesn't case-insensitively match an existing product name — an unbounded, un-deduplicated side effect of ordinary invoice editing.

## Reliability Findings

- Railway's `startCommand` runs `npx prisma db push --accept-data-loss ; npm start` on **every** deploy and restart — schema drift is auto-applied with data loss pre-accepted, with no backup step first.
- Backups (`lib/backup.ts`) write gzip JSON to local disk by default (`BACKUP_DIR`), unencrypted; no Railway persistent volume was found configured, so on an ephemeral filesystem these backups would not survive a redeploy unless the optional S3 env vars are set — **unverified**, needs confirmation against the live Railway project settings.
- No restore path was exercised or found to be exercised in this repo beyond a code reference in `lib/init-db.ts`'s doc comments; "a backup can be restored" is unverified.
- `railway.json` and `railway.toml` specify different healthcheck paths — configuration drift that should be resolved to avoid ambiguous deploy behavior.

## Access Limitations (please read before acting on this report)

I do **not** have:
- A connection to the production database (only a local, throwaway Postgres instance seeded from the repo's own fixtures was used, and it has since been dropped).
- Production application logs, Railway deploy logs, or Railway environment variables.
- Any real customer, employee, or payment data.

Everything above is either (a) a defect in the source code itself — true regardless of environment — or (b) a defect reproduced against local test data I created and destroyed in this session. **Nothing in this report exposes real customer or company data.** To complete Phase 2 (first-week usage statistics) and the live half of Phase 3 (reconciling actual production totals), I need either read-only production database credentials or exported logs/CSV extracts, provided through a channel outside this chat.

---

See `RISK_REGISTER.md`, `ACCOUNTING_RECONCILIATION.md`, `TEST_RESULTS.md`, `ACTION_PLAN.md`, and `MANAGEMENT_DASHBOARD_SPEC.md` for the full detail behind each section above.
