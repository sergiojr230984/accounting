# La Cuevita Accounting

## Purpose

La Cuevita Accounting is a web-based bookkeeping and back-office system for **La Cuevita Furniture**. It is the company's primary operational software, used daily to quote work, invoice customers, record supplier bills, take payments, and see how the business is actually doing.

In plain terms, the app answers four questions for the business:

1. **What have we quoted, and did it turn into a sale?** (estimates, and one-click conversion to an invoice)
2. **Who owes us money, and how much?** (customer invoices, payment status, outstanding balances)
3. **Who do we owe, and for what?** (supplier bills, categorized by COGS / services / operating expense)
4. **How is the business actually doing?** (profit & loss, gross margin, per-invoice profitability, sales-rep commissions, product mix)

It also has a lightweight AI-assisted intake flow: a staff member can upload a photo or PDF of a paper invoice and Claude (Anthropic's API) extracts the line items automatically instead of the item being typed in by hand.

This documentation describes the codebase on branch `claude/accounting-system-issue-P9dod`, which is the actively developed, production-track branch (see `CHANGELOG.md`'s "[Unreleased] — Production remediation pass" and `DEPLOYMENT.md`).

---

## Business Functions

Verified directly against the route handlers (`app/api/`), pages (`app/`), and database schema (`prisma/schema.prisma`) in this branch.

### Estimates (`/estimates`)
- Create, list, view, edit, and delete price quotes for a customer, with line items, tax, subtotal/total.
- Status lifecycle: `DRAFT` → `SENT` → `ACCEPTED` / `DECLINED` / `EXPIRED`.
- **Send by email** (via Resend) with a public, tokenized view link (`/estimate/[token]`), which also marks the estimate `SENT`.
- **Convert to invoice** in one action — copies the estimate's line items into a new `CustomerInvoice`, marks the estimate `ACCEPTED`, and links the two records (`convertedInvoiceId`). Protected by a database row lock so two concurrent conversion clicks can't double-book the same estimate into two invoices.

### Customer Invoices (`/invoices/customer`)
- Create, list, view, edit, and delete invoices, each tied to a `Customer`.
- Line items with quantity, unit price, and per-line tax rate; totals computed server-side with `decimal.js`, each line rounded to 2 decimals before being summed (so subtotal always agrees with the sum of its own lines).
- Optional **credit card processing fee** (percentage, from company settings) and arbitrary **custom fees** (also from settings), each capped server-side against its configured rate so a tampered client request can't inflate a fee beyond what its rate allows.
- Down payments and paid amounts; payment status (`UNPAID` / `PARTIALLY_PAID` / `PAID`) is always recomputed server-side, never trusted from the client. Overpayment (e.g., a cash customer rounding up) is allowed and shows as a credit balance rather than being rejected.
- **Once a payment has been recorded, existing line items become financial history** — they can no longer be edited or removed via the edit screen (new lines can still be added), and the invoice itself can no longer be deleted. This also holds for an individual item once a purchase request has been generated against it (auto-created the moment a payment is first recorded, for purchasing to act on — see `lib/purchase-requests.ts`), even if the invoice's payment status is later corrected back to `UNPAID`: the item stays locked, though new lines can still be freely added. Short of either of those, an `UNPAID` invoice is fully editable.
- Sales-rep assignment (`Employee`) and a commission rate per invoice; a `SALES`-role user is always auto-attributed to their own linked employee record on creation, regardless of what the client sends.
- File attachments (PDF/JPG/PNG/CSV, ≤10MB) stored on disk, with the stored file extension derived from the validated MIME type (not the client-supplied filename).
- PDF generation (`lib/invoice-pdf.ts`, via `jspdf`) with company branding/logo, itemized lines, fees, and payment history.
- **Send by email** (Resend) with a public, tokenized payment page (`/pay/[token]`) showing the invoice, balance due, and payment history.
- **Payment ledger**: record, edit, and delete individual payments against an invoice (`/api/invoices/customer/[id]/payments`), each write done inside a row-locked transaction so concurrent payments can't clobber each other's contribution to the running total.
- New invoice line items are auto-synced into the `Product` catalog (existence-check + bulk insert, not one query per line).

### Supplier Bills (`/invoices/supplier`)
- Create, list, view, edit, and delete bills, each tied to a `Supplier`.
- Categorized as `COGS`, `SERVICES_EXPENSE`, `OPERATING_EXPENSE`, or `OTHER` — this drives the P&L report.
- Same line-item, tax, rounding, "payment locks line items," and file-attachment mechanics as customer invoices (using `unitCost` instead of `unitPrice`). `paidAmount` is rejected server-side if it would exceed the bill's total.
- An optional `customerInvoiceRef` field links a bill back to the customer invoice it was purchased for, enabling per-job cost tracking (used by the Profitability report).

### Customers (`/customers`)
- Create, edit, delete (blocked if the customer has existing invoices), and list, with an invoice count per customer.
- Emergency contact fields (name/phone) — relevant to furniture delivery/installation.
- Address field has autocomplete suggestions as you type (see Integrations).

### Suppliers (`/suppliers`)
- Create, edit, delete (blocked if the supplier has existing bills), and list, with an invoice count per supplier.
- Default expense category, payment terms (days), and banking/payment details (bank name, account, routing, Zelle, free-text instructions).
- Bank/payment details are stripped from the API response for any role other than `ADMIN`/`MANAGER`.

### Products & Services (`/products`)
- A real, manageable catalog: list, create, and edit (name, description, price, tax rate, income account, active flag).
- Creating/editing is **Admin-only**, specifically to stop staff from spawning near-duplicate entries (e.g., five slightly different "Delivery" line items) that would fragment the frequency report; duplicate names (case-insensitive) are rejected.
- **No delete** — a product can only be deactivated (`active: false`), because past invoices reference it by name with no foreign key, and deleting one would orphan the frequency report's grouping for every historical invoice that used it.
- Also auto-populated by invoice line items (see Customer Invoices above).
- A `TaxRate` catalog (name + rate) is managed from Settings and offered as a dropdown on invoice line items.

### Employees & Commissions
- `Employee` records (name, email, phone, active flag, commission rate) optionally linked to a login account (`User`) by matching email.
- Commission rate is stripped from the API response for any role other than `ADMIN`/`MANAGER`.
- Managed at `/employees` (create/update/delete are Admin-only; delete is blocked if the employee is linked to any invoice).

### Performance (`/performance`, Admin/Manager)
- A company-wide sales leaderboard: per-employee invoice count, total sales, total commission owed, and paid-invoice rate, over an optional date range. Deliberately not visible to `SALES` — it's a peer-comparison view, not a personal one.

### Reports (`/reports`)
- **Income** — customer invoices in a date range, with total.
- **Expenses** — supplier bills in a date range, totaled and broken down by category.
- **Profit & Loss** — income minus COGS (gross profit), minus services/operating expenses (net profit), with gross/net margin percentages.
- **Customer Outstanding** / **Supplier Outstanding** — unpaid/partially-paid invoices or bills and the balance owed.
- **Profitability** — matches each customer invoice to any supplier bills referencing it (via `customerInvoiceRef`) to show per-invoice revenue, cost, gross profit, and margin.
- **Product Frequency** (`/reports/frequency`, Admin-only) — groups invoice line items by normalized description to show how often each product/service is sold, total revenue, average price, and months active; flags likely near-duplicate item names so the catalog can be cleaned up.

### Dashboard (`/dashboard`, Admin — hidden from the nav for other roles)
- KPI cards for income, COGS, gross/net profit, and unpaid customer/supplier totals.
- A 12-month income/expense/profit area chart (`recharts`), expenses broken out by category.

### Settings (`/settings`)
- **Company profile**: name, logo (uploaded as a data URL, also served as the site favicon via `/api/brand-icon`), address, email, phone.
- **Credit card processing fee**: a percentage rate + display label, offered as an optional per-invoice fee.
- **Custom fees**: an arbitrary list of additional named/rated fees invoices can apply.
- **Invoice/bill numbering**: prefix and next-sequence-number for both `CustomerInvoice` and `SupplierInvoice`.
- **Tax rates**: a managed list (name + rate + active flag) offered as a dropdown on invoice line items.
- **Users**: create/deactivate/edit accounts and roles (same data as `/api/users`, surfaced here).
- **Audit Log**: browse/export the audit trail (see below).
- Writing any of the above (`PATCH`) is Admin-only at the API level; note the page itself is reachable by any signed-in user — see [Known Limitations](#known-limitations).

### AI Invoice Data Extraction
- Upload a photo (JPG/PNG/WebP) or PDF of a paper invoice; it's sent to the Anthropic API (`claude-opus-4-7`), which returns structured JSON (invoice number, dates, line items, tax rate, and — for bills — a suggested expense category) that pre-fills the invoice form. Requires `ANTHROPIC_API_KEY`; rate-limited to 10 calls/minute/IP.

### User Management & Audit Log (Admin-only)
- Create, edit (name/email/role/active/password), and deactivate (soft-delete) accounts. Guardrails: a user can't demote, deactivate, or delete themselves, and the last active Admin can't be demoted/deactivated/deleted.
- **Audit Log** (`AuditLog` table): an append-style ledger of who did what — invoice/customer/supplier/product/user create/update/delete, role changes, and access-denied attempts — written best-effort from most mutating routes via `lib/audit.ts`. Browsable and CSV-exportable at `/settings` → Audit Log / `/api/audit-log`, filterable by date, actor, action, entity type, and free-text search.

### Diagnostics & session-recovery endpoints
- `/api/health` — dependency-free liveness probe (always 200; DB status is in the response body). This is what Railway's own healthcheck hits.
- `/api/health/full` — the same data, but returns a real 503 when the database is unreachable, intended for external uptime monitoring (see `DEPLOYMENT.md`).
- `/api/me` — diagnostic endpoint showing what `auth()` vs. the direct-JWT-decode fallback (`resolveViewer()`) each see for the current session; used to debug role/session issues in production.
- `/api/sign-out`, `/api/clear-session` — two independent, low-level session-cookie-clearing endpoints, both documented as workarounds for NextAuth v5-beta sign-out issues (see [Known Limitations](#known-limitations)).
- `/api/brand-icon` — serves the company logo (decoded from the base64 data URL stored on `CompanyProfile`) as the site favicon.

---

## User Roles

Roles are stored on `User.role` as `ADMIN`, `MANAGER`, `SALES`. In the UI, `SALES` is labeled **"Employee."** There is no longer a single centralized permission matrix file (an earlier iteration of this app had one at `lib/permissions.ts`; it does not exist on this branch) — authorization is enforced per-route via two helpers in `lib/api.ts`:

- `requireAuth()` — any authenticated, active user.
- `requireRole(...roles)` — authenticated **and** role-checked.

The table below reflects what each API route actually enforces today (verified in code), not just what the sidebar shows or hides:

| Resource | SALES ("Employee") | MANAGER | ADMIN |
|---|---|---|---|
| Estimates — read/create/update/delete/send/convert | ✅ | ✅ | ✅ |
| Customer invoices — read/create/update | ✅ | ✅ | ✅ |
| Customer invoices — delete (only while `UNPAID`) | ✅ | ✅ | ✅ |
| Customer invoice payments — create/edit/delete | ✅ | ✅ | ✅ |
| Supplier bills — read/create/update/delete | ✅ | ✅ | ✅ |
| Customers — read/create/update | ✅ | ✅ | ✅ |
| Customers — delete | ❌ | ✅ | ✅ |
| Suppliers — read (bank details hidden) | ✅ | ✅ (full) | ✅ (full) |
| Suppliers — create/update/delete | ❌ | ✅ | ✅ |
| Employees — read (commission hidden) | ✅ | ✅ (full) | ✅ (full) |
| Employees — create/update/delete | ❌ | ❌ | ✅ |
| Products — read | ✅ | ✅ | ✅ |
| Products — create/update | ❌ | ❌ | ✅ |
| Reports (income/expenses/P&L/outstanding/profitability) — API | ✅ | ✅ | ✅ |
| Reports — nav visibility | hidden | ✅ | ✅ |
| Product Frequency report | ❌ | ❌ | ✅ |
| Performance leaderboard | ❌ | ✅ | ✅ |
| Dashboard KPI API | ✅ | ✅ | ✅ |
| Dashboard — nav visibility | hidden | hidden | ✅ |
| Settings — read | ✅ (page reachable by any signed-in user) | ✅ | ✅ |
| Settings — write (company profile, fees, taxes, numbering) | ❌ | ❌ | ✅ |
| Users — all operations | ❌ | ❌ | ✅ |
| Audit Log | ❌ | ❌ | ✅ |

**Important nuance verified directly in the code:** several resources — supplier **bills** (as opposed to Suppliers themselves), **Estimates**, and the main **Reports** API — have no role check at all in their route handlers (only `requireAuth()`/session presence). A `SALES` user is not shown these in the sidebar, but a direct API call from that role succeeds. This differs from what `DEPLOYMENT.md` describes ("transactional routes... are gated to ADMIN or MANAGER") — see [Known Limitations](#known-limitations).

**One account is permanently pinned to ADMIN, independent of this table:** `sales@lacuevitafurniture.com` — the business owner's sign-in — is hardcoded as ADMIN in `lib/auth.ts`, `lib/viewer.ts`, and `lib/init-db.ts`. Its role self-heals back to ADMIN on the next login or server boot even if it's ever changed via Settings → Users. This is a deliberate, owner-approved policy (confirmed 2026-08): it's the one and only account used to sign in, and it must never be lockable-out of its own system. It is not reflected in the table above because it overrides the table rather than fitting into it.

`SALES`-role scoping is currently **attribution-only, not visibility-only**: a `SALES` user creating a customer invoice is automatically linked to their own `Employee` record (via matching email) and can't be assigned to someone else's, but the invoice list itself is company-wide for every role — the code's own comment states this is intentional ("Company-wide accounting system — every employee sees every invoice, regardless of who it's attributed to").

---

## Technology Stack

**Framework & language**
- [Next.js 15](https://nextjs.org/) (App Router) — pages, API routes, and middleware in one codebase
- React 18, TypeScript 5

**Database & ORM**
- PostgreSQL
- [Prisma](https://www.prisma.io/) 5 (`@prisma/client`), schema in `prisma/schema.prisma`
- `decimal.js` for exact-precision monetary math, mirroring Prisma's `Decimal` columns

**Auth**
- [NextAuth.js v5 (beta)](https://authjs.dev/), Credentials provider (email + bcrypt password), JWT sessions capped at 12 hours
- `bcryptjs` for password hashing, including a constant-time dummy-hash comparison on login failure to avoid a timing side-channel that would otherwise reveal whether an email has an account

**UI**
- Tailwind CSS, `lucide-react` icons
- `react-hook-form` + `zod` (+ `@hookform/resolvers`) for form validation
- `recharts` for the dashboard chart

**Documents, email & files**
- `jspdf` + `jspdf-autotable` — invoice/bill PDF generation
- `resend` — transactional email (invoice/estimate send)
- Node's `fs` for local disk storage of uploads

**AI**
- `@anthropic-ai/sdk` (Claude) — invoice data extraction from uploaded images/PDFs

**Observability & reliability**
- `@sentry/nextjs` — client, server, and edge error capture (`sentry.*.config.ts`, wired via `instrumentation.ts`)
- In-house in-memory sliding-window rate limiter (`lib/rate-limit.ts`), applied to login, invoice/estimate email-send, file upload, and AI extraction

**Testing**
- `vitest` (+ `@vitest/ui`) — integration test suite in `tests/` (auth, invoices, estimates, permissions, uploads, and a workflow-coverage sweep), run against a real database via `tests/setup/global-setup.ts`

**Address autocomplete**
- Client-side calls to **OpenStreetMap's free Nominatim API** (`components/AddressAutocomplete.tsx`) — no API key, no billing. See [Known Limitations](#known-limitations) regarding `GOOGLE_MAPS_SETUP.md` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, which describe a different, unused integration.

**Other installed packages**
- `@tanstack/react-query`, `papaparse` — installed but not imported anywhere in the app's source.

**Hosting/Infra**
- [Railway](https://railway.app/) (Nixpacks builder) — see `railway.json` and `DEPLOYMENT.md`
- GitHub — source control and PR-based workflow

**No separate third-party auth provider** (Auth0/Clerk/etc.) — auth is self-hosted via NextAuth/Credentials. **No dedicated object storage** for invoice file attachments (local disk only) or backup system in this branch (see Known Limitations for what was removed relative to earlier work).

---

## Repository Structure

```
app/
  (dashboard)/            Every authenticated page, gated by app/(dashboard)/layout.tsx:
    dashboard/              KPI dashboard (Admin)
    invoices/customer/      List, new, [id] detail/edit
    invoices/supplier/      List, new, [id] detail/edit
    estimates/               List, new, [id] detail/edit
    customers/, suppliers/   Management screens
    employees/                Employee management (Admin)
    performance/              Sales leaderboard (Admin/Manager)
    products/                  Product/service catalog
    reports/, reports/frequency/  Financial reports
    settings/                  Company profile, taxes, fees, numbering, users, audit log
  api/                     All backend route handlers (see API section below)
  estimate/[token]/        Public, unauthenticated estimate view (tokenized link)
  pay/[token]/             Public, unauthenticated invoice payment view (tokenized link)
  login/                   Login page
  layout.tsx, page.tsx     Root layout and "/" entry
components/                Shared client components: Sidebar, TopBar, DashboardShell, Providers
                            (NextAuth SessionProvider), invoice items editor, product/address
                            autocomplete, invoice extractor, file upload, badges, login form
lib/                       Server-side logic shared across routes:
  auth.ts                    NextAuth config: rate-limited/timing-safe login, 12h JWT sessions,
                              per-request role re-check against the DB, active-user revocation
  api.ts                     requireAuth/requireRole guards, SALES employee-scoping helper,
                              apiError/checkRateLimit helpers, direct-JWT-cookie fallback
  viewer.ts                  Independent JWT-decode identity resolver (used by the dashboard
                              layout as a defense against a NextAuth v5-beta session bug)
  rate-limit.ts               In-memory sliding-window limiter
  prisma.ts                  Prisma client singleton
  init-db.ts                 Idempotent raw-SQL schema bootstrap + admin auto-promotion; the
                              sole schema-provisioning mechanism in production (no migrations)
  next-number.ts              Single-query next-sequence-number generator (invoices/estimates)
  product-catalog.ts           Batched invoice-line-item → Product catalog auto-sync
  money.ts                    Decimal helpers and currency formatting
  date.ts                     UTC-safe date formatting
  invoice-pdf.ts               PDF generation
  upload.ts                   File upload validation/storage (MIME-derived extensions)
  email.ts                    Resend wrapper
  audit.ts                    Audit log writer
prisma/
  schema.prisma               Source-of-truth data model (16 models)
  seed.ts                     Demo data seeder (`npm run db:seed`)
scripts/setup-db-role.sql     One-time least-privilege Postgres role setup for production
tests/                       Vitest integration suite + global DB setup
sentry.*.config.ts            Sentry client/server/edge configuration
middleware.ts                 Cookie-presence route guard + CSRF Origin/Referer check
instrumentation.ts             Boots Sentry + runs the DB bootstrap once per server instance
CHANGELOG.md                  Detailed, dated record of fixes/features — the best single source
                              for what has changed and why
DEPLOYMENT.md                 Railway/Postgres/Sentry/Better-Uptime operations runbook
SETUP_PRODUCTION.md            Three manual setup steps only a human with account access can do
GOOGLE_MAPS_SETUP.md           Stale — describes an integration not used by the current code
CUSTOM_DOMAIN.md               How the production custom domain was configured
SETUP.md                      Legacy — an older "BizLedger"-branded quick-start doc, superseded
                              by DEPLOYMENT.md (see Known Limitations)
```

---

## Database

PostgreSQL via Prisma — 16 models declared in `prisma/schema.prisma`.

| Entity | Purpose |
|---|---|
| **User** | A login account: `role` (ADMIN/MANAGER/SALES), `active` flag, bcrypt password hash, `lastLogin`. |
| **Customer** | A buyer: contact info + emergency-contact fields (delivery/installation context). Has many `CustomerInvoice`s and `Estimate`s. |
| **Supplier** | A vendor: contact info, payment terms, default expense category, banking/payment instructions. Has many `SupplierInvoice`s. |
| **Estimate** | A price quote to a customer. Status (`DRAFT`/`SENT`/`ACCEPTED`/`DECLINED`/`EXPIRED`), optional expiry, a `viewToken` for the public share link, and `convertedInvoiceId` once turned into a real invoice. |
| **EstimateItem** | A line item on an estimate. |
| **CustomerInvoice** | A sales invoice. Subtotal/tax/total, paid amount, down payment, credit card fee, arbitrary applied fees (JSON), payment status, optional assigned `Employee` + commission rate, and a `viewToken` for the public payment link. |
| **CustomerInvoiceItem** | A line item on a customer invoice. |
| **SupplierInvoice** | A bill from a supplier, categorized (COGS/services/operating/other). Can reference the customer invoice it was purchased for (`customerInvoiceRef`), enabling job-costing. |
| **SupplierInvoiceItem** | A line item on a supplier bill. |
| **Payment** | A payment record against either a customer invoice or a supplier invoice (not both). |
| **CompanyProfile** | Single-row settings (`id = "default"`): name/logo/address/contact info, credit-card fee rate/label, custom fees, invoice/bill numbering prefix + next sequence. |
| **TaxRate** | A named, reusable, active/inactive tax rate, offered on invoice line items. |
| **Product** | A managed catalog entry (name, description, price, tax rate, income account, active flag), also auto-populated from invoice line items. |
| **Employee** | A staff member assignable to customer invoices, with a commission rate. Optionally linked to a `User` login by matching email. |
| **UploadedFile** | Metadata for a file attached to a customer or supplier invoice. |
| **AuditLog** | Append-style ledger: timestamp, actor (id/name/role), action, entity type/id/label, a JSON diff of changed fields, IP, user agent. Indexed on timestamp, actor, entity type, and action. |

**Relationships at a glance:** `Customer` 1—N `CustomerInvoice`/`Estimate`; `CustomerInvoice`/`Estimate` 1—N their respective `*Item` tables; `Supplier` 1—N `SupplierInvoice` 1—N `SupplierInvoiceItem`; `Payment` and `UploadedFile` each optionally belong to one `CustomerInvoice` or one `SupplierInvoice`; `Employee` 1—N `CustomerInvoice`; `Estimate.convertedInvoiceId` is a one-to-one pointer to the `CustomerInvoice` it became.

**Schema management has no migration history.** This project does not use versioned Prisma migrations in production. `lib/init-db.ts` runs a list of idempotent, hand-written `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements once per server instance (via `instrumentation.ts`, guarded by an in-flight promise so concurrent callers can't race past a still-in-progress bootstrap). `DEPLOYMENT.md` is explicit that Railway's Pre-Deploy Command **must stay empty** — schema creation happens at first request, not at deploy time. The same file also force-promotes hard-coded admin emails to `ADMIN`, migrates a legacy `admin@bizledger.com` account if found, and seeds a fallback admin with a random (never-logged) password if zero `ADMIN` users exist.

---

## API

All routes live under `app/api/` — 40 route files. Except `/api/health`, `/api/health/full`, `/api/auth/[...nextauth]`, `/api/sign-out`, `/api/clear-session`, and `/api/brand-icon`, every route requires a session (`requireAuth()`/`auth()`), with role checks (`requireRole(...)`) layered on top where noted in the [User Roles](#user-roles) table above.

**Estimates**
- `GET/POST /api/estimates` — list (paginated, filterable) / create.
- `GET/PATCH/DELETE /api/estimates/[id]` — fetch, update, delete.
- `GET /api/estimates/next-number` — next `EST-{year}-####` number.
- `POST /api/estimates/[id]/send` — email the customer a public view link (rate-limited).
- `POST /api/estimates/[id]/convert` — convert to a `CustomerInvoice` (row-locked transaction).

**Customer Invoices**
- `GET/POST /api/invoices/customer` — list (paginated, filterable) / create.
- `GET/PATCH/DELETE /api/invoices/customer/[id]` — fetch, update, delete (only while `UNPAID`).
- `GET /api/invoices/customer/next-number` — next `INV-{prefix}{n}` number.
- `POST /api/invoices/customer/[id]/send` — email the customer a public payment link (rate-limited).
- `POST /api/invoices/customer/[id]/payments` — record a payment (row-locked transaction).
- `PATCH/DELETE /api/invoices/customer/[id]/payments/[paymentId]` — edit/remove a specific payment, recomputing the invoice's paid amount and status.

**Supplier Bills**
- `GET/POST /api/invoices/supplier` — list (paginated, filterable) / create.
- `GET/PATCH/DELETE /api/invoices/supplier/[id]` — fetch, update, delete (only while `UNPAID`).

**Invoice Data Extraction**
- `POST /api/invoices/extract` — sends an uploaded PDF/image to Claude and returns extracted invoice fields (rate-limited).

**Customers / Suppliers**
- `GET/POST /api/customers`, `PATCH /api/customers/[id]` (any role) — `DELETE /api/customers/[id]` (ADMIN/MANAGER, blocked if invoices exist).
- `GET /api/suppliers` (bank fields scrubbed for SALES), `POST/PATCH/DELETE` (ADMIN/MANAGER; delete blocked if bills exist).

**Employees**
- `GET/POST /api/employees` (read: any role, commission scrubbed for SALES; create: ADMIN).
- `PATCH/DELETE /api/employees/[id]` — ADMIN; delete blocked if linked to any invoice.

**Products**
- `GET/POST /api/products` — read: any role; create: ADMIN, rejects case-insensitive duplicate names.
- `PATCH /api/products/[id]` — ADMIN (no DELETE — see Business Functions).

**Files**
- `POST /api/upload` — attach a validated file (PDF/JPG/PNG/CSV, ≤10MB) to an invoice or bill (rate-limited).

**Dashboard, Reports & Performance**
- `GET /api/dashboard` — KPI totals + 12-month chart data (any authenticated role).
- `GET /api/reports?type=...` — `income`, `expenses`, `profit-loss`, `customer-outstanding`, `supplier-outstanding`, `profitability` (any authenticated role).
- `GET /api/reports/frequency` — product/service frequency analysis (ADMIN only).
- `GET /api/performance` — sales leaderboard (ADMIN/MANAGER only).

**Settings**
- `GET/PATCH /api/settings` — company profile (read: any role; write: ADMIN).
- `GET/POST /api/settings/taxes`, `PATCH/DELETE /api/settings/taxes/[id]` — tax rate catalog (read: any role; write: ADMIN).

**Users & Audit**
- `GET/POST /api/users`, `PATCH/DELETE /api/users/[id]` — ADMIN only; delete is a soft-delete (deactivate); guards against self-demotion/self-deactivation/self-deletion and removing the last active admin.
- `GET /api/audit-log` — browse/CSV-export the audit trail (ADMIN only).

**Auth & session**
- `POST /api/auth/[...nextauth]` — NextAuth credentials sign-in (rate-limited by IP and by submitted email).
- `GET/POST /api/sign-out` — clears every NextAuth cookie variant via an HTML response (not a redirect — see code comment on why).
- `GET /api/clear-session` — a second, simpler cookie-clearing fallback.
- `GET /api/me` — diagnostic: compares what `auth()` vs. direct JWT decode see for the current session.

**Diagnostics (unauthenticated)**
- `GET /api/health` — always 200; DB status in the body. Railway's healthcheck target.
- `GET /api/health/full` — same data, returns 503 on DB outage; meant for external uptime monitoring.
- `GET /api/brand-icon` — serves the company logo as the site favicon.

---

## Reports

1. **Income** — customer invoice totals over a date range.
2. **Expenses** — supplier bill totals over a date range, by category.
3. **Profit & Loss** — income, COGS, services/operating expenses, gross/net profit, gross/net margin.
4. **Customer Outstanding** / **Supplier Outstanding** — unpaid/partially-paid balances due.
5. **Profitability** — per-customer-invoice revenue vs. matched supplier cost, gross profit and margin.
6. **Product Frequency** — sales frequency, revenue, average price, and near-duplicate name detection (Admin only).
7. **Dashboard KPIs & 12-month chart** — income/expense/profit trend, separate from the Reports page (Admin only).
8. **Performance leaderboard** — per-salesperson invoice count, sales total, commission total, paid rate (Admin/Manager only).

There is no Balance Sheet or Cash Flow report in this codebase.

---

## Integrations

- **Anthropic Claude API** — AI-assisted invoice data extraction from uploaded images/PDFs (`app/api/invoices/extract/route.ts`). Requires `ANTHROPIC_API_KEY`; degrades gracefully (a clear error, not a crash) when unset.
- **Resend** — transactional email for "send" actions on invoices and estimates (`lib/email.ts`). Requires `RESEND_API_KEY`; without it, sends return a friendly error while PDF/print/copy-link flows keep working.
- **OpenStreetMap Nominatim** — free, keyless address autocomplete on the customer address field (`components/AddressAutocomplete.tsx`), debounced client-side calls restricted to US results.
- **Sentry** — error monitoring for server, client, and edge runtimes. Requires `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_ORG`/`SENTRY_PROJECT` for source-map upload at build time, which is otherwise disabled).
- **Better Uptime** (or any HTTP monitor) — not code in this repo, but `DEPLOYMENT.md`/`SETUP_PRODUCTION.md` document pointing an external monitor at `/api/health/full`.

**Documented but not actually used:** `GOOGLE_MAPS_SETUP.md` and the `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` env var describe wiring up Google's Places API for address autocomplete — but the actual `AddressAutocomplete` component calls OpenStreetMap's Nominatim API instead, which needs no key at all. See [Known Limitations](#known-limitations).

There is no WhatsApp, Meta, Clover, or financing-provider integration anywhere in this codebase.

---

## Deployment

**Hosting:** [Railway](https://railway.app/), Nixpacks builder. Full runbook in `DEPLOYMENT.md`.

- **Build command:** `npm ci && npm run build`. **Start command:** `npm start`. **Pre-Deploy Command must be empty** — schema creation happens idempotently at first request via `lib/init-db.ts`, not at deploy time; leaving a `prisma db push`/`migrate deploy` in Pre-Deploy will hang the deploy.
- **Healthcheck:** `/api/health` (always 200 by design — a dependency-free liveness probe so a transient DB blip doesn't trigger a restart loop; real DB status is in the response body). `railway.json`'s `healthcheckPath` and `DEPLOYMENT.md` agree on this.
- **Restart policy:** `ON_FAILURE`, up to 3 retries.
- **Database security:** Railway's own Postgres role has full ownership. `scripts/setup-db-role.sql` creates a separate, least-privilege `accounting_app` role (SELECT/INSERT/UPDATE/DELETE only, no DDL) that `DATABASE_URL` should be switched to in production, keeping the owner role's connection string separately for schema changes only.
- **Source control:** GitHub, PR-based. `DEPLOYMENT.md` currently names `claude/accounting-system-issue-P9dod` as the deploy branch, "until merged to `main`."
- **Custom domain:** `lacuevitafurniture.com`, set up per `CUSTOM_DOMAIN.md` (CNAME/ALIAS records → Railway, `APP_URL`/`AUTH_URL` env vars updated to match).

**Environment variables** (see `.env.example` for the authoritative list):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (auto-provided by Railway's Postgres add-on) |
| `AUTH_SECRET` | Yes | NextAuth JWT signing secret — `openssl rand -base64 32` |
| `ADMIN_EMAILS` | Recommended | Comma-separated extra emails to auto-promote to ADMIN on every boot |
| `ANTHROPIC_API_KEY` | Recommended | Enables AI invoice extraction |
| `APP_URL` | Recommended | Public base URL used to build payment/estimate links in outgoing emails |
| `UPLOAD_DIR` | Recommended | Local directory for invoice file attachments |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional | Enables the Send/Email buttons |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional, currently unused | Reserved for a Google Places integration the code doesn't call — see Known Limitations |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Optional | Error monitoring |

**Production admin access:** on first boot with zero admin users, `lib/init-db.ts` creates `admin@lacuevita.com` with a **random, never-logged password** (a deliberate hardening choice — see `CHANGELOG.md`'s "Stopped logging the fallback admin password in plaintext"). Recovering that account requires setting its password directly in the database.

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# fill in DATABASE_URL and AUTH_SECRET at minimum

# 3. Push the schema to your local Postgres database
npm run db:push
# (or npm run db:migrate for a dev-migration workflow)

# 4. Seed demo data
npm run db:seed

# 5. Run the dev server
npm run dev
```

Other useful scripts (`package.json`):
- `npm run build` / `npm start` — production build and run.
- `npm run lint` — Next.js ESLint.
- `npm test` / `npm run test:watch` / `npm run test:ui` — Vitest integration suite (spins up against a real database via `tests/setup/global-setup.ts`).
- `npm run db:studio` — Prisma Studio, a local DB browser.
- `npm run db:generate` — regenerate the Prisma client after a schema change.

---

## Architecture Notes

- **Money is never handled as native JavaScript numbers.** All monetary calculation goes through `decimal.js` (`lib/money.ts`), matching Postgres's `Decimal(15,2)`/`Decimal(5,4)` columns. Each invoice/bill line is rounded to 2 decimals *before* being summed into the subtotal — a deliberate fix (see `CHANGELOG.md`) for a prior bug where a full-precision running sum could legitimately disagree by a cent with the sum of its own already-rounded stored lines.
- **Payment status is always derived server-side**, from `totalAmount`/`paidAmount`/`downPayment`, never trusted from the client, on both create and update.
- **Money that's already changed hands is immutable.** Once a customer or supplier invoice has any recorded payment, its existing line items can no longer be edited or removed (new lines can still be appended), and the invoice can no longer be deleted outright — enforced by comparing every incoming line item against its stored counterpart byte-for-byte.
- **Concurrency-sensitive money operations use real row locks**, not optimistic reads. Recording a payment and converting an estimate to an invoice both run inside a Prisma `$transaction` with a raw `SELECT ... FOR UPDATE`, closing races where two concurrent requests could both read a stale value and one write clobber the other's contribution.
- **Authorization is layered, not single-point.** `middleware.ts` only checks for the *presence* of a session cookie (fast, Edge-safe — it deliberately avoids invoking NextAuth's own config, which needs Prisma/bcrypt and crashes under Edge Middleware) to redirect anonymous users to `/login`, plus an independent CSRF Origin/Referer check on mutating API calls. The actual authorization happens per-request inside each route via `requireAuth()`/`requireRole()` (`lib/api.ts`) or `auth()` + manual role checks.
- **Two independent identity-resolution paths exist side by side**, and this is deliberate, not incidental: `lib/auth.ts`'s `auth()` wrapper (re-checks `active` status against the DB on every call, closing a NextAuth v5-beta gap where a deactivated user's session would otherwise silently keep validating) and `lib/viewer.ts`'s `resolveViewer()` (decodes the JWT cookie directly, independent of NextAuth's own session pipeline). `lib/api.ts`'s `requireAuth()` additionally falls back to a direct JWT-cookie decode if `auth()` comes back sessionless — all three exist because, per in-code comments, NextAuth v5-beta's App Router session handling has repeatedly returned a technically-truthy-but-effectively-empty session in this deployment.
- **Schema changes ship without migration history.** Production runs `lib/init-db.ts`'s hand-maintained, idempotent raw SQL on server boot rather than `prisma migrate deploy` — the `SCHEMA_STATEMENTS` list **is** the change log, and a table/column added to `prisma/schema.prisma` without a matching entry there will 500 in production even though `prisma generate` succeeds locally. `CHANGELOG.md` documents this having actually happened twice (`Estimate`/`EstimateItem`, then `AuditLog`) before being caught and fixed.
- **Rate limiting is single-instance, by design for now.** `lib/rate-limit.ts` is an in-memory sliding window; `DEPLOYMENT.md` documents the exact one-file swap to Upstash Redis if the app is ever scaled to multiple Railway replicas.
- **This codebase has been through a documented security/correctness hardening pass** (`CHANGELOG.md`'s "[Unreleased] — Production remediation pass"): stored-XSS fix in uploads, closed fail-open auth paths, removed two unauthenticated admin endpoints, removed a secret-length leak from `/api/me`, login rate limiting + timing-attack fix, CSP/HSTS headers, immediate session revocation on deactivation, 12-hour session lifetime, and the row-lock/rounding fixes described above.

---

## Known Limitations

Concrete, code-verified gaps and inconsistencies — not speculation:

1. **`GOOGLE_MAPS_SETUP.md` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` describe an integration the code doesn't use.** `components/AddressAutocomplete.tsx` calls OpenStreetMap's free Nominatim API, not Google's Places API. The setup doc and env var are stale/vestigial.
2. **`DEPLOYMENT.md`'s authorization description doesn't fully match the routes.** It states "transactional routes (invoice create/edit, customer/supplier CRUD) are gated to ADMIN or MANAGER," but supplier-bill create/edit, all Estimate operations, and the main Reports API (`/api/reports`) accept **any authenticated role**, including SALES, at the API level — they're only hidden from SALES in the sidebar. See the [User Roles](#user-roles) table for the verified, route-by-route reality.
3. **`/settings` is reachable by any signed-in user, not just Admins**, per an explicit comment in `app/(dashboard)/settings/layout.tsx` — a documented, deliberate trade-off after role-detection through the NextAuth pipeline repeatedly failed to recognize a specific admin account. Actually *writing* settings (`PATCH` endpoints) still requires ADMIN at the API level, so a non-admin can view but not change configuration.
4. **`SETUP.md` is a legacy, superseded document.** It still refers to the product as "BizLedger," documents `admin@bizledger.com` / `manager@bizledger.com` seed credentials, and describes a project layout and formula set that predates Estimates, Settings, and the audit log. `DEPLOYMENT.md` and `SETUP_PRODUCTION.md` are the current operational docs.
5. **Two independent NextAuth sign-out endpoints exist** (`/api/sign-out`, `/api/clear-session`), both explicitly framed in their own code comments as workarounds for NextAuth v5-beta sign-out/redirect problems that recurred enough to need a second, simpler fallback.
6. **The dashboard KPI API (`/api/dashboard`) has no role restriction**, unlike `/api/performance` and `/api/reports/frequency`, which explicitly restrict to ADMIN/MANAGER or ADMIN. It's simply not shown to non-ADMIN roles in the sidebar.
7. **No Balance Sheet or Cash Flow report exists**, despite being conceptually adjacent to the implemented P&L report.
8. **Two dependencies are installed but unused anywhere in the app's source:** `papaparse` and `@tanstack/react-query`.
9. **No data-export or backup feature exists in this branch.** (An earlier iteration of this system had scheduled/manual backup endpoints and a full-data-export route; neither is present here.)
10. **`package.json`'s version (`1.5.2`) is ahead of the highest version heading in `CHANGELOG.md` (`[1.1.0]`).** The "[Unreleased] — Production remediation pass" section describes the work since 1.1.0 in detail but has not yet been given its own version heading.

---

## Future Roadmap

Derived directly from the gaps above and from in-code comments describing intended follow-ups — not speculative feature ideas:

- Reconcile `DEPLOYMENT.md`'s authorization description with the actual route implementations (either tighten Bills/Estimates/Reports to ADMIN/MANAGER to match the doc, or update the doc to describe the current, more permissive reality and confirm it's intentional).
- Finish rebuilding role detection through the primary NextAuth session pipeline so `/settings` can go back to being ADMIN-gated at the page level, not just at the mutation-API level (`app/(dashboard)/settings/layout.tsx`'s own comment flags this as the blocker).
- Retire `SETUP.md` (or rewrite it to match the current product) now that `DEPLOYMENT.md` and `SETUP_PRODUCTION.md` cover setup and operations.
- Either wire up `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`/rewrite `GOOGLE_MAPS_SETUP.md` to describe the OpenStreetMap integration actually in use, or remove the unused env var and doc.
- Move `lib/rate-limit.ts` to a distributed store (Upstash Redis) before scaling Railway beyond a single replica — the swap point is already isolated to one function per `DEPLOYMENT.md`.
- Add a `CHANGELOG.md` version heading for the current "[Unreleased]" work to match `package.json`'s `1.5.2`.
- Consider a Balance Sheet / Cash Flow report as a natural extension of the existing P&L report's category-based aggregation.
- Remove the unused `papaparse` and `@tanstack/react-query` dependencies, or put them to use (e.g., CSV import, client-side data caching) if there's a concrete need.
