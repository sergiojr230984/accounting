# Test Results — Initial Pass

All tests below were run against a **disposable local environment**: PostgreSQL 16 running locally, database created and dropped within this session, schema pushed straight from the repo's `prisma/schema.prisma`, data seeded via the repo's own `prisma/seed.ts`, app served via `next dev` on `localhost:3100`. No production system, real customer data, real email, or real payment method was touched. All test artifacts (database, `.env.local.audit`, running server) were deleted at the end of the session; `git status` was confirmed clean afterward.

Log references are inline `curl`/`psql` output captured during the session, not files (no persistent log storage was set up for this pass).

| # | Test | Expected result | Actual result | Pass/Fail |
|---|---|---|---|---|
| 1 | Fresh `prisma db push --accept-data-loss` against an empty DB (mirrors Railway's start command) | Creates all tables the application code depends on | Created 13 tables; **no `AuditLog` or `BackupLog` table** (`psql \dt` / targeted `pg_tables` query confirmed zero matches for `%audit%`/`%backup%`) | **Fail** |
| 2 | `npx tsc --noEmit` on a clean install | Zero compile errors | **32 errors** across `app/api/admin/1099/route.ts`, `app/api/admin/audit-log/route.ts`, `app/api/admin/backups/route.ts`, `app/api/admin/backups/cron/route.ts`, `app/api/suppliers/[id]/route.ts`, `lib/audit.ts` | **Fail** |
| 3 | `npx tsx prisma/seed.ts` against the fresh DB | Seeds baseline users/fixtures | Succeeded; printed `Admin: admin@lacuevita.com / admin123`, `Manager: manager@lacuevita.com / manager123` | Pass (seed itself works) — but see Risk R-1 for why this is a finding, not a clean pass |
| 4 | `next dev` boot, watch `instrumentation.ts` → `initializeDatabase()` | Boots cleanly | Boots, but logs `[init-db] statement failed: ... Code 23502 ... Failing row contains (default, null, null, ...)` — the raw-SQL `CompanyProfile` bootstrap insert fails a NOT NULL constraint (`updatedAt`) against a Prisma-created table, because Prisma's `@updatedAt` is client-managed, not a DB default | **Fail** (non-fatal, but confirms the raw-SQL bootstrap path is broken against the schema Prisma actually produces) |
| 5 | `GET /api/debug` with **no** session cookie | Should require authentication | `HTTP 200`, full JSON body including `dbHost`, `dbPort`, `dbName`, `hasAuthSecret: true`, `authSecretLength: 53`, `authUrl` | **Fail** (security) |
| 6 | Login as `admin@lacuevita.com` / `admin123` via `/api/auth/callback/credentials` | Succeeds, session cookie issued | `HTTP 302`, session cookie set, subsequent authenticated calls succeeded | Pass (functionally works — but see R-1: this credential shouldn't exist) |
| 7 | `GET /api/test-db` **as a logged-in user** | Should require ADMIN and should not mutate data | `HTTP 200`; returned full `Customer`/`Supplier` column lists; `"customerCreate":"ok"` confirming a live create+delete of a `__test__` row in the `Customer` table | **Fail** (security + data-integrity) |
| 8 | `POST /api/customers` with name+email | Creates a customer | `HTTP 200`, customer created with expected fields | Pass |
| 9 | `GET /api/invoices/customer/next-number` | Returns a usable next invoice number | `HTTP 200`, `{"nextNumber":"INV-2026-5"}` — computed from `MAX(existing sequence)+1`, not from the `CompanyProfile.customerInvoiceNextSeq` counter field that exists for this purpose | Pass (returns *a* number) / **Fail** (wrong mechanism — see R-7 for why this isn't safe under concurrency) |
| 10 | `POST /api/invoices/customer` — 3 × $19.99 line item @ 8.25% tax, explicit `invoiceNumber: "INV-2026-1001"` (deliberately not the suggested number, to test whether the server enforces it) | Either the server assigns/validates the number, or accepts it | `HTTP 200`, invoice created with the arbitrary number I supplied, no validation against the suggested sequence; `subtotal: "59.97"`, `taxAmount: "4.95"`, `totalAmount: "64.92"` — math correct | Pass (calculation) / **Fail** (no server-side numbering enforcement) |
| 11 | `POST /api/invoices/customer/{id}/payments` — record a $30 partial payment (the actual "Add Payment" button workflow) | Creates a `Payment` record, updates invoice balance | `HTTP 404` — route does not exist | **Fail** (critical — core workflow) |
| 12 | `PATCH /api/invoices/customer/{id}` with `paidAmount: "500.00"` on a $64.92 invoice (workaround path / overpayment test) | Should reject an amount exceeding the balance | `HTTP 200`, `paidAmount: "500"`, `paymentStatus: "PAID"` — accepted with no validation | **Fail** (critical — accounting integrity) |
| 13 | Search codebase for a "send invoice by email" API route | Should exist, matching the frontend's `POST /api/invoices/customer/{id}/send` call | No route file found anywhere under `app/api/invoices/**` | **Fail** (critical — core workflow) |
| 14 | Search codebase for the public customer pay/view portal (`/pay`, whitelisted in `middleware.ts`, backed by `CustomerInvoice.viewToken`) | Should exist as a page | No `app/pay/**` directory exists | **Fail** (feature entirely unbuilt) |
| 15 | Search codebase for a "void invoice" endpoint (declared in `lib/permissions.ts`'s matrix) | Should exist | No route implements a void action; only hard `DELETE` exists | **Fail** (feature entirely unbuilt) |
| 16 | Search codebase for rate limiting on login or any endpoint | Should exist given production, public-facing login | No matches anywhere in the repo | **Fail** (security) |

## Not yet tested (out of scope for this pass, recommended as follow-up)

- PDF generation content/formatting accuracy.
- Multi-tax-rate invoices, line-item and invoice-level discounts, shipping/service fees, credit-card fee surcharge, commission-rate math.
- Concurrent-edit / double-submit / refresh-during-submit behavior (code inspection confirms no optimistic-locking or idempotency-key protection exists — see Risk R-9 — but this wasn't exercised end-to-end with two simultaneous clients).
- Mobile/responsive layout.
- Session-expiration behavior and unauthorized-access attempts beyond what's covered above.
- SQL injection / XSS / CSRF fuzzing of form inputs (Prisma's parameterized queries make classic SQL injection unlikely in the paths reviewed, but this wasn't exhaustively fuzzed).
- Dependency vulnerability scan (`npm audit` was not run this pass).

## Reproduction notes

Local environment specifics, for whoever wants to re-run this: PostgreSQL 16 (`pg_ctlcluster 16 main start`), `DATABASE_URL=postgresql://postgres:***@localhost:5432/accounting_audit_test`, `npx prisma db push --accept-data-loss`, `npx tsx prisma/seed.ts`, `npx next dev -p 3100`. Login flow requires fetching a CSRF token from `/api/auth/csrf` first and posting it alongside credentials to `/api/auth/callback/credentials` (NextAuth v5 credentials flow) to get a usable session cookie for further `curl` calls.
