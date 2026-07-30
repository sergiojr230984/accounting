# La Cuevita Accounting

## Purpose

La Cuevita Accounting is a web-based bookkeeping and back-office system for **La Cuevita Furniture**. It is the company's primary operational software, used daily to issue customer invoices, record supplier bills, track payments, run financial reports, and manage the small team that uses the system.

In plain terms, the app answers three questions for the business:

1. **Who owes us money, and how much?** (customer invoices, payment status, outstanding balances)
2. **Who do we owe, and for what?** (supplier bills, categorized by COGS / services / operating expense)
3. **How is the business actually doing?** (profit & loss, gross margin, per-invoice profitability, product mix)

It also has a lightweight AI-assisted intake flow: a staff member can upload a photo or PDF of a paper invoice, and Claude (Anthropic's API) extracts the line items automatically instead of the item being typed in by hand.

---

## Business Functions

The functions below are implemented — verified directly against the route handlers, page components, and database schema in this repository. Where something is wired into the UI but not fully implemented on the backend, that is called out explicitly (see [Known Limitations](#known-limitations)).

### Customer Invoices (`/invoices/customer`)
- Create, list, view, edit, and delete invoices, each tied to a `Customer`.
- Line items with quantity, unit price, and per-line tax rate; totals (subtotal, tax, total) are computed server-side using `decimal.js` to avoid floating-point rounding errors.
- Optional **credit card processing fee** (percentage, configured on `CompanyProfile`) and arbitrary **custom fees**, both auto-added to the invoice total when selected.
- Down payments and paid amounts, with payment status (`UNPAID` / `PARTIALLY_PAID` / `PAID`) always recomputed server-side from the numbers on file — the client cannot set it directly.
- Sales-rep assignment (`Employee`) and a commission rate per invoice.
- File attachments (PDF/JPG/PNG/CSV, up to 10MB) stored on disk.
- PDF generation (`lib/invoice-pdf.ts`, via `jspdf`) with company branding, itemized lines, fees, and payment history.
- A `viewToken` field exists on the invoice for a "share a payment link" feature, but the public page that would consume it does not exist yet (see Known Limitations).
- New invoice line items are auto-synced into a `Product` catalog table in the background (create-only; there is no UI or API to browse/edit that catalog today).

### Supplier Bills (`/invoices/supplier`)
- Create, list, view, edit, and delete bills, each tied to a `Supplier`.
- Bills are categorized as `COGS`, `SERVICES_EXPENSE`, `OPERATING_EXPENSE`, or `OTHER` — this categorization drives the P&L report.
- Same line-item, tax, PDF, and file-attachment mechanics as customer invoices (using `unitCost` instead of `unitPrice`).
- An optional `customerInvoiceRef` field lets a bill be linked back to the customer invoice it was purchased for, enabling per-job cost tracking (used by the Profitability report).

### Customers (`/customers`)
- Create, edit, delete (blocked if the customer has existing invoices), and list, with an invoice count per customer.
- Emergency contact fields on the customer record (name/phone) — used for furniture delivery/installation contexts.

### Suppliers (`/suppliers`)
- Create, edit, delete (blocked if the supplier has existing bills), and list, with an invoice count per supplier.
- Default expense category, payment terms (days), and payment/banking details (bank name, account, routing, Zelle, free-text instructions).
- A 1099-contractor data model is present in the UI form and API validation (`is1099Contractor`, TIN, legal name, W-9 status, etc.), but the underlying database columns for it do not exist — see Known Limitations.

### Products & Services
- Products are auto-created from invoice line-item descriptions (name, price, tax rate) to build a growing catalog, but there is currently no page or API to view, search, or manage that catalog directly, despite a "Products & Services" link in the sidebar.
- A `TaxRate` model also exists in the schema (name + rate) but nothing in the codebase creates, reads, updates, or deletes it — it is currently unused.

### Employees & Commissions
- `Employee` records (name, email, phone, active flag, commission rate) that can be linked to a login account (`User`) via matching email.
- The `SALES` role ("Employee" in the UI) automatically only sees and creates invoices tied to their own `Employee` record, and their commission rate defaults from their profile.
- Managed at `/admin/employees` (admin-only).

### Payments
- A `Payment` model (amount, date, notes) exists and can belong to either a customer invoice or a supplier invoice.
- In practice, the invoice edit screens set `paidAmount` directly on the invoice record and recompute status from it. Seed data also creates `Payment` rows directly. A dedicated itemized-payment-ledger API that the invoice detail page's UI calls (`/api/invoices/customer/[id]/payments`) is not implemented in this repository — see Known Limitations.

### Reports (`/reports`, admin/manager only — see [User Roles](#user-roles))
All reports are computed live from the database (no separate reporting tables):
- **Income** — all customer invoices in a date range, with total.
- **Expenses** — all supplier bills in a date range, totaled and broken down by category.
- **Profit & Loss** — income minus COGS (gross profit), minus services/operating expenses (net profit), with gross/net margin percentages. Admin-only.
- **Customer Outstanding** — unpaid/partially-paid customer invoices and the balance owed.
- **Supplier Outstanding** — unpaid/partially-paid supplier bills and the balance owed.
- **Profitability** — matches each customer invoice to any supplier bills referencing it (via `customerInvoiceRef`) to show per-invoice revenue, cost, gross profit, and margin.
- **Frecuencia de Productos y Servicios** (`/reports/frequency`, admin-only) — groups invoice line items by normalized description to show how often each product/service is sold, total revenue, average price, and months active; also flags likely near-duplicate item names (e.g. inconsistent spelling of the same product) so the catalog can be cleaned up.

### Dashboard (`/dashboard`, admin only)
- KPI cards for income, COGS, gross/net profit, and unpaid customer/supplier totals.
- A 12-month income/expense/profit area chart (via `recharts`).
- Optional date-range filtering.

### AI Invoice Data Extraction
- Staff can upload a photo (JPG/PNG) or PDF of a paper invoice; the file is sent to the Anthropic API (`claude-opus-4-7`), which returns structured JSON (invoice number, dates, line items, tax rate, category for bills) that pre-fills the invoice form. Requires `ANTHROPIC_API_KEY`.

### User Management & Access Control (admin only)
- Create, edit (name/role/active/password), and deactivate (soft-delete) user accounts at `/admin/users`.
- Guardrails prevent removing the last active Admin and prevent a user from changing their own role.
- A centralized permission matrix (`lib/permissions.ts`) is the single source of truth for what each role can do to each resource (read/create/update/delete/void/export), used by both API routes and the sidebar.

### Data Export
- `/api/admin/export` (admin only) streams a gzipped JSON snapshot of the core business tables (users, customers, suppliers, invoices, items, payments, uploaded files) for download.

### Diagnostics
- `/api/health` — trivial liveness check (used by Railway's healthcheck).
- `/api/debug` and `/api/test-db` — unauthenticated diagnostic endpoints that report environment variable presence, database connectivity, and (for `/api/test-db`) live column introspection. These are operational/debugging aids, not business features, and are publicly reachable (see Known Limitations).

### Features present in the UI/API but not fully functional today
These are documented in detail in [Known Limitations](#known-limitations) rather than listed as working features: **Audit Log**, **Backups**, and **1099 Contractor Reporting / TIN encryption**.

---

## User Roles

Roles are stored on the `User.role` enum as `ADMIN`, `MANAGER`, `SALES`. In the UI, `SALES` is labeled **"Employee"**.

| Area | Employee (`SALES`) | Manager (`MANAGER`) | Admin (`ADMIN`) |
|---|---|---|---|
| Dashboard | no access (route hidden; admin-only) | no access | full |
| Customer invoices — read/create/update | own invoices only | all | all |
| Customer invoices — delete/void | ❌ | ✅ | ✅ |
| Customers | create/edit | create/edit/delete | full |
| Products & Services (sidebar link) | visible | hidden | visible |
| Supplier bills | ❌ (no read/create) | ✅ | ✅ |
| Suppliers | ❌ | ✅ | ✅ |
| Contractor TIN | ❌ | ❌ | ✅ (feature currently non-functional, see below) |
| Reports: Income / Expenses / Outstanding / Profitability | ❌ | ✅ | ✅ |
| Reports: Profit & Loss, Frequency report | ❌ | ❌ | ✅ |
| Employees | ❌ | ❌ | ✅ |
| Users | ❌ | ❌ | ✅ |
| Audit Log, Backups, 1099 admin pages | ❌ | ❌ | ✅ (features currently non-functional, see below) |

This matrix is enforced in two places that must be kept in sync: `lib/permissions.ts` (the authoritative `(role, resource, action)` matrix, used inside API routes) and `components/Sidebar.tsx` (which role can *see* a nav item — a UI convenience, not a security boundary by itself).

Role determination for `SALES` users on invoices works by matching the logged-in user's email to an `Employee` record's email — a `SALES` user with no matching `Employee` record sees an empty invoice list rather than an error.

---

## Technology Stack

**Framework & language**
- [Next.js 15](https://nextjs.org/) (App Router) — pages, API routes, and middleware in one codebase
- React 18, TypeScript 5

**Database & ORM**
- PostgreSQL
- [Prisma](https://www.prisma.io/) 5 (`@prisma/client`) as the primary ORM, defined in `prisma/schema.prisma`
- `decimal.js` for exact-precision monetary math (mirroring Prisma's `Decimal` columns)

**Auth**
- [NextAuth.js v5 (beta)](https://authjs.dev/) with the Credentials provider (email + bcrypt-hashed password), JWT sessions
- `bcryptjs` for password hashing

**UI**
- Tailwind CSS
- `lucide-react` icon set
- `react-hook-form` + `zod` (+ `@hookform/resolvers`) for form validation
- `recharts` for the dashboard chart

**Documents & files**
- `jspdf` + `jspdf-autotable` — invoice/bill PDF generation
- Node's built-in `fs` for local file storage of uploads and backups

**AI**
- `@anthropic-ai/sdk` (Claude) — invoice data extraction from uploaded images/PDFs

**Other installed packages**
- `@aws-sdk/client-s3` — optional S3-compatible upload target for backups
- `nodemailer` — optional SMTP email alert on failed scheduled backups (dynamically imported)
- `date-fns` — date formatting
- `papaparse`, `@tanstack/react-query` — installed but **not currently used** anywhere in the app (see Known Limitations)

**Hosting/Infra**
- [Railway](https://railway.app/) (Nixpacks builder) — see `railway.json` / `railway.toml`
- GitHub — source control and CI-adjacent workflow (PRs)

**No separate auth provider (Auth0/Clerk/etc.), no dedicated object-storage provider for everyday file uploads (local disk only), no message queue, no cache layer.**

---

## Repository Structure

```
app/
  (admin)/admin/          Admin-only pages: dashboard hub, users, audit-log, backups, 1099, employees
  (dashboard)/            Authenticated pages for all roles: dashboard, invoices, customers, suppliers, reports
  api/                    All backend route handlers (see API section below)
  login/                  Login page
  layout.tsx, page.tsx    Root layout and "/" redirect to /invoices/customer
  global-error.tsx        Top-level error boundary
components/               Shared React client components (Sidebar, TopBar, invoice editor, file upload,
                           invoice extractor, badges, stat cards, customer-create modal)
lib/                      Server-side logic shared across routes:
  auth.ts / auth.config.ts   NextAuth configuration
  permissions.ts             Centralized RBAC matrix
  prisma.ts                  Prisma client singleton
  init-db.ts                 Idempotent raw-SQL schema bootstrap + admin auto-promotion, run on server start
  money.ts                   Decimal helpers and currency formatting
  date.ts                    UTC-safe date formatting
  invoice-pdf.ts              PDF generation
  upload.ts                  File upload validation/storage
  audit.ts                   Audit log writer (see Known Limitations — currently non-functional)
  backup.ts                  Backup/export/prune logic (see Known Limitations — currently non-functional)
  tin-crypto.ts               AES-256-GCM TIN encrypt/decrypt helpers (currently unreachable — no schema field)
prisma/
  schema.prisma              Source-of-truth data model
  seed.ts                    Demo data seeder (`npm run db:seed`)
  migrations/audit_log_append_only.sql   Manual DB hardening script for an AuditLog table (not yet created)
types/next-auth.d.ts        Type augmentation for session/JWT (adds `id`, `role`)
middleware.ts               Cookie-presence route guard (redirects unauthenticated users to /login)
instrumentation.ts           Next.js hook that runs the DB bootstrap once per server instance
public/uploads/              Default local storage location for uploaded files
railway.json / railway.toml   Railway build/deploy configuration
.env.example                  Full list of environment variables the app reads
SETUP.md                      Operator runbook (permission matrix, backups, restore, TIN, 1099 setup)
```

---

## Database

PostgreSQL via Prisma. The tables below are the ones actually declared in `prisma/schema.prisma` (13 models). Two additional tables (`AuditLog`, `BackupLog`) are referenced by application code but are **not** in the schema — see [Known Limitations](#known-limitations).

| Entity | Purpose |
|---|---|
| **User** | A login account. Has a `role` (ADMIN/MANAGER/SALES), an `active` flag (soft-delete), and a bcrypt password hash. |
| **Customer** | A buyer. Holds contact info plus emergency-contact fields (relevant to furniture delivery). Has many `CustomerInvoice`s. |
| **Supplier** | A vendor the business buys from. Holds contact info, payment terms, default expense category, and banking/payment instructions. Has many `SupplierInvoice`s. |
| **CustomerInvoice** | A sales invoice to a customer. Tracks subtotal/tax/total, paid amount, down payment, credit card fee, arbitrary applied fees (JSON), payment status, an optional assigned `Employee` and commission rate, and an optional `viewToken` for a (not-yet-built) public payment link. |
| **CustomerInvoiceItem** | A line item on a customer invoice: description, quantity, unit price, tax rate, line total. |
| **SupplierInvoice** | A bill from a supplier. Categorized as COGS/services/operating/other for P&L purposes. Can reference the customer invoice it was purchased for (`customerInvoiceRef`), enabling job-costing. |
| **SupplierInvoiceItem** | A line item on a supplier bill: description, quantity, unit cost, tax rate, line total. |
| **Payment** | A payment record against either a customer invoice or a supplier invoice (one or the other, not both). |
| **CompanyProfile** | A single-row settings table (`id = "default"`): company name/logo/contact info, credit-card fee rate/label, custom fees, and the next invoice/bill numbers with their prefixes. |
| **TaxRate** | A named, reusable tax rate. Declared in the schema but currently unused by any route or page. |
| **Product** | A catalog entry (name, description, price, tax rate, income account). Populated automatically from invoice line items; not yet exposed through any UI or API for direct management. |
| **Employee** | A staff member who can be assigned to customer invoices and earn commission. Optionally linked to a `User` login by matching email. |
| **UploadedFile** | Metadata for a file attached to either a customer or supplier invoice (original/stored name, mime type, size, disk path). |

**Relationships at a glance:** `Customer` 1—N `CustomerInvoice` 1—N `CustomerInvoiceItem`; `Supplier` 1—N `SupplierInvoice` 1—N `SupplierInvoiceItem`; `Payment` optionally belongs to one `CustomerInvoice` or one `SupplierInvoice`; `UploadedFile` optionally belongs to one `CustomerInvoice` or one `SupplierInvoice`; `Employee` 1—N `CustomerInvoice`.

**Schema management is unusual and worth understanding before touching it:** this project does not use versioned Prisma migrations. Instead:
1. `prisma/schema.prisma` defines the target shape for `prisma generate` (type-safe client) and local `prisma db push`.
2. In production, Railway's start command runs `npx prisma db push --accept-data-loss` before booting the app.
3. On top of that, `lib/init-db.ts` runs a list of idempotent, hand-written `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements once per server instance (via `instrumentation.ts`), independently of Prisma. This also auto-promotes a hard-coded email (`admin@lacuevita.com`) and any emails listed in `ADMIN_EMAILS` to the `ADMIN` role, migrates a legacy `admin@bizledger.com` account if found, and seeds a default admin (`admin@lacuevita.com` / `admin123`) if no admin exists.

---

## API

All routes live under `app/api/`. Except `/api/health`, `/api/debug`, `/api/test-db`, and the NextAuth handler, every route calls `auth()` and returns `401` if there's no session; role/resource checks (via `lib/permissions.ts` or `isAdmin()`) return `403` on top of that.

**Auth**
- `POST /api/auth/[...nextauth]` — NextAuth credential sign-in/sign-out (standard NextAuth catch-all).

**Customer Invoices**
- `GET/POST /api/invoices/customer` — list (paginated, filterable by customer/status/date; SALES users see only their own) / create.
- `GET/PATCH/DELETE /api/invoices/customer/[id]` — fetch, update (recomputes totals and payment status), delete (admin only).
- `GET /api/invoices/customer/next-number` — computes the next `INV-{year}-{n}` invoice number.

**Supplier Bills**
- `GET/POST /api/invoices/supplier` — list (paginated, filterable) / create.
- `GET/PATCH/DELETE /api/invoices/supplier/[id]` — fetch, update, delete.

**Invoice Data Extraction**
- `POST /api/invoices/extract` — sends an uploaded PDF/image to Claude and returns extracted invoice fields.

**Customers**
- `GET/POST /api/customers` — list / create.
- `PATCH/DELETE /api/customers/[id]` — update, delete (blocked if the customer has invoices).

**Suppliers**
- `GET/POST /api/suppliers` — list / create.
- `PATCH/DELETE /api/suppliers/[id]` — update (including the 1099-related fields — see Known Limitations), delete (blocked if the supplier has bills).

**Employees**
- `GET /api/employees` — active employees, for assignment dropdowns (any authenticated user).
- `GET/POST /api/admin/employees` — full list with invoice counts / create (admin only).
- `PATCH/DELETE /api/admin/employees/[id]` — update/delete (admin only).

**Files**
- `POST /api/upload` — attach a validated file (PDF/JPG/PNG/CSV, ≤10MB) to a customer or supplier invoice.

**Dashboard & Reports**
- `GET /api/dashboard` — KPI totals and 12-month chart data.
- `GET /api/reports?type=...` — `income`, `expenses`, `profit-loss`, `customer-outstanding`, `supplier-outstanding`, `profitability`.
- `GET /api/reports/frequency` — product/service frequency analysis (admin only).

**Admin**
- `GET/POST /api/admin/users` — list / create user accounts.
- `PATCH/DELETE /api/admin/users/[id]` — update role/active/password; delete is a soft-delete (deactivate).
- `GET /api/admin/export` — download a gzipped JSON export of core tables.
- `GET /api/admin/audit-log` — list/export the audit trail (currently errors — see Known Limitations).
- `GET/POST /api/admin/backups`, `POST /api/admin/backups/cron` — manual/scheduled backup trigger and status (currently errors — see Known Limitations).
- `GET /api/admin/1099` — 1099 contractor report/CSV export (currently errors — see Known Limitations).

**Diagnostics (unauthenticated)**
- `GET /api/health` — always returns `{ ok: true }`; used by Railway's healthcheck.
- `GET /api/debug` — reports env-var presence and a live DB ping.
- `GET /api/test-db` — reports DB connectivity, `Customer`/`Supplier` column lists, and a create/delete round-trip.

---

## Reports

All reports currently available in the product:

1. **Income** — customer invoice totals over a date range.
2. **Expenses** — supplier bill totals over a date range, broken down by expense category.
3. **Profit & Loss** — income, COGS, services/operating expenses, gross profit, net profit, gross/net margin (admin only).
4. **Customer Outstanding** — unpaid/partially-paid customer invoices and balances due.
5. **Supplier Outstanding** — unpaid/partially-paid supplier bills and balances due.
6. **Profitability** — per-customer-invoice revenue vs. matched supplier cost, gross profit and margin.
7. **Frecuencia de Productos y Servicios** — product/service sales frequency, revenue, average price, and near-duplicate name detection (admin only).
8. **Dashboard KPIs & 12-month chart** — income/expense/profit trend (admin only, separate from the Reports page).

Balance Sheet and Cash Flow reports are mentioned in `SETUP.md`'s permission matrix but are **not implemented** — there is no route or page for either.

---

## Integrations

- **Anthropic Claude API** — used for AI-assisted invoice data extraction from uploaded images/PDFs (`app/api/invoices/extract/route.ts`). Requires `ANTHROPIC_API_KEY`.
- **S3-compatible object storage** (AWS SDK) — optional upload target for backup files (`lib/backup.ts`). Only used for backups, not for everyday invoice file attachments. Requires `BACKUP_S3_*` env vars; silently skipped if unset.
- **SMTP email** (via `nodemailer`, dynamically imported) — sends a failure alert email if a scheduled backup fails. Requires `BACKUP_ALERT_EMAIL` + `SMTP_*` env vars; silently skipped if unset.

**Declared but not implemented:** `.env.example` reserves `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_API_VERSION` for a WhatsApp Business Cloud API (Meta) integration, but no code anywhere in the repository sends, receives, or verifies WhatsApp messages. There is no Clover, Google, or financing-provider integration anywhere in the codebase.

---

## Deployment

**Hosting:** [Railway](https://railway.app/), using the Nixpacks builder.

- `railway.json` sets the build (`npm ci && npm run build`) and start command. The start command runs `npx prisma db push --accept-data-loss` before `npm start` on every deploy, pushing the current `schema.prisma` shape straight to the production database (no migration history/rollback — see [Architecture Notes](#architecture-notes)).
- `railway.toml` sets restart policy (`ON_FAILURE`, up to 3 retries) and a healthcheck. **Note:** `railway.json` points the healthcheck at `/` while `railway.toml` points it at `/api/health` — these two files disagree (see Known Limitations).
- On top of Railway's own DB push, `instrumentation.ts` runs `lib/init-db.ts`'s raw-SQL bootstrap the first time the Node.js server process starts, as a second, idempotent safety net for schema and admin-account state.

**Source control:** GitHub. Work happens on feature branches and is merged via pull request into `main`.

**Environment variables** (see `.env.example` for the full, authoritative list):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | NextAuth JWT signing secret (min 32 chars) |
| `NEXTAUTH_URL` | Yes | Public base URL of the deployment |
| `UPLOAD_DIR` | Yes | Local directory for invoice file attachments |
| `ANTHROPIC_API_KEY` | For AI extraction | Enables the invoice data extraction feature |
| `TIN_ENCRYPTION_KEY` | For 1099/TIN | 64-char hex AES-256-GCM key (feature currently unreachable — no schema field) |
| `BACKUP_DIR` | For backups | Local directory for backup files (feature currently non-functional — no `BackupLog` model) |
| `BACKUP_CRON_SECRET` | For scheduled backups | Shared secret required on `POST /api/admin/backups/cron` |
| `BACKUP_S3_*` | Optional | S3-compatible upload target for backups |
| `BACKUP_ALERT_EMAIL`, `SMTP_*` | Optional | Email alert on failed scheduled backup |
| `WHATSAPP_*` | Not used | Reserved, unimplemented |
| `ADMIN_EMAILS` | Optional | Comma-separated extra emails to auto-promote to Admin on server start |

**Production admin access:** on first boot with zero admin users, `lib/init-db.ts` seeds `admin@lacuevita.com` / `admin123`. This should be changed immediately in any real deployment.

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# fill in DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL, UPLOAD_DIR at minimum

# 3. Push the schema to your local Postgres database
npx prisma migrate dev
# (or: npx prisma db push)

# 4. Seed demo data (creates admin@lacuevita.com / admin123 and manager@lacuevita.com / manager123)
npm run db:seed

# 5. Run the dev server
npm run dev
```

Other useful scripts (`package.json`):
- `npm run build` / `npm start` — production build and run.
- `npm run lint` — Next.js ESLint (note: build-time linting/type-checking is disabled in `next.config.ts`, so `npm run lint` and `tsc` are the only way to see real errors locally — see Known Limitations).
- `npm run db:studio` — Prisma Studio, a local DB browser.
- `npm run db:generate` — regenerate the Prisma client after schema changes.

---

## Architecture Notes

- **Money is never handled as native JavaScript numbers.** All monetary calculation goes through `decimal.js` (`lib/money.ts`), matching the `Decimal(15,2)`/`Decimal(5,4)` column types in Postgres, to avoid floating-point rounding drift on totals, tax, and margins.
- **Payment status is always derived, never trusted from the client.** Both the create and update invoice routes recompute `paymentStatus` from `totalAmount`, `paidAmount`, and `downPayment` server-side.
- **Authorization is layered, not single-point.** `middleware.ts` only checks for the *presence* of a session cookie (fast, edge-safe, no JWT verification) to redirect anonymous users to `/login`. The actual authorization — verifying the session and checking the permission matrix — happens per-request inside each API route via `auth()` and `lib/permissions.ts`. The middleware is a UX convenience, not the security boundary.
- **Schema changes ship without migration history.** Rather than `prisma migrate deploy`, production pushes `schema.prisma` directly (`db push --accept-data-loss`) and additionally runs a hand-maintained list of idempotent raw SQL statements (`lib/init-db.ts`) on server boot. This lets schema patches roll out without a migrations folder, at the cost of no rollback path and no schema change history — the `SCHEMA_STATEMENTS` list in `lib/init-db.ts` **is** the change log.
- **Type-checking and linting are disabled at build time.** `next.config.ts` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`, with a comment explaining this is specifically to let the 1099/TIN/audit-log/backup routes reference Prisma fields and models that don't exist in the schema yet, without blocking deploys. This is a deliberate, documented trade-off, not an oversight — but it also means the build will not catch *other*, unrelated type errors either.
- **This codebase was narrowed from a broader CRM.** Commit history (`3c37189 fix: remove all CRM code from the accounting branch`) shows CRM functionality was intentionally stripped out to leave a pure accounting system. A few CRM-era artifacts remain cosmetically (e.g., the login page still reads "La Cuevita — CRM & Contabilidad").
- **The product was rebranded at some point from "BizLedger."** `lib/init-db.ts` contains one-time migration logic that renames a legacy `admin@bizledger.com` account to `admin@lacuevita.com` if found.

---

## Known Limitations

These are concrete, code-verified gaps — not speculation:

1. **Audit Log is non-functional.** `lib/audit.ts` and `app/api/admin/audit-log/route.ts` call `prisma.auditLog`, but no `AuditLog` model exists in `prisma/schema.prisma`, and no `CREATE TABLE` for it exists in `lib/init-db.ts`. Every `writeAuditLog()` call site across the app (invoice creation, user changes, access-denied events, etc.) will fail at runtime; it's wrapped in try/catch so it fails silently rather than breaking the calling request, but nothing is actually being logged.
2. **Backups are non-functional.** `app/api/admin/backups/*` and `app/api/admin/export/route.ts` reference `prisma.backupLog`, which also has no corresponding model or table. The underlying export logic in `lib/backup.ts` (gzip JSON snapshot of core tables) is otherwise complete and would work if `BackupLog` were added.
3. **1099 contractor reporting and TIN encryption are unreachable.** `app/api/admin/1099/route.ts` and the supplier update route reference `Supplier.is1099Contractor`, `taxId`, `taxIdType`, `legalName`, `businessAddress`, `w9OnFile`, `default1099Box`, and `Payment.paymentMethod` — none of which exist in the schema. `lib/tin-crypto.ts` (AES-256-GCM encrypt/decrypt) is fully implemented but has no field to write to.
4. **These three gaps are explicitly acknowledged in the codebase itself** — `next.config.ts` disables build-time TypeScript and ESLint checking specifically because of them.
5. **Several sidebar links point to pages that don't exist:** `/products`, `/employees` (non-admin variant), `/performance`, and `/settings` all 404 today.
6. **The public invoice payment link is incomplete.** `CustomerInvoice.viewToken` and a "Share payment link" UI action exist, and `middleware.ts` allowlists `/pay` as a public path, but there is no `/pay/[token]` page to serve it.
7. **The itemized payment ledger API is missing.** The customer invoice detail page calls `POST/PATCH/DELETE /api/invoices/customer/[id]/payments`, but that route does not exist in the repository. Paid amounts are set via the invoice's own `paidAmount` field instead.
8. **The WhatsApp (Meta) integration is a stub.** Environment variables are reserved in `.env.example` but no messaging code exists.
9. **`Product` is write-only and `TaxRate` is entirely unused.** Products accumulate automatically from invoice line items with no way to view/manage them; `TaxRate` has no code touching it at all.
10. **`CompanyProfile` (company info, invoice numbering, fee settings) has no admin UI or API for editing** — it's only read at invoice-creation time and auto-incremented, with default values baked into the schema.
11. **Deployment configs disagree on healthcheck path** (`railway.json`: `/`, `railway.toml`: `/api/health`).
12. **`SETUP.md` documents a restore script (`scripts/restore.js`) that does not exist** in the repository.
13. **Two dependencies are installed but unused:** `papaparse` and `@tanstack/react-query`.
14. **Diagnostic endpoints (`/api/debug`, `/api/test-db`) are unauthenticated** and expose environment variable presence/length, database host/port/name, and (for `/api/test-db`) live schema column names — useful for troubleshooting a Railway deploy, but they should not be reachable in a hardened production environment.

---

## Future Roadmap

Derived directly from the gaps above and the explicit intent in `next.config.ts`'s comments — not speculative feature ideas:

- Add `AuditLog` and `BackupLog` models to `prisma/schema.prisma` (plus matching statements in `lib/init-db.ts`) so the already-written audit trail and backup history actually persist.
- Add the 1099/TIN columns to `Supplier` and a `paymentMethod` column to `Payment`, unlocking the already-written 1099 report and TIN encryption.
- Once the schema catches up, remove `ignoreBuildErrors`/`ignoreDuringBuilds` from `next.config.ts` to restore real compile-time safety.
- Build the missing pages already linked in the sidebar: Products & Services catalog, non-admin Employees view, Performance, Settings.
- Build the `/pay/[token]` public payment page to complete the invoice-sharing feature that `viewToken` was added for.
- Build the missing per-invoice payments API (`/api/invoices/customer/[id]/payments`) so the payment ledger UI on the invoice detail page functions as written.
- Either implement the WhatsApp Business Cloud API integration the env vars were reserved for, or remove them.
- Add `scripts/restore.js`, referenced by `SETUP.md`'s restore procedure but not present in the repo.
- Add a Settings/API surface for editing `CompanyProfile` (branding, invoice numbering, fee configuration) instead of relying on schema defaults.
- Move production schema management from `db push --accept-data-loss` + hand-written raw SQL to versioned Prisma migrations, once the team is ready to take on migration review as part of the deploy process.
- Reconcile the healthcheck path mismatch between `railway.json` and `railway.toml`.
