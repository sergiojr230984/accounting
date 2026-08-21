# Risk Register — La Cuevita Accounting System

Ranked most severe first. Every row is either **Confirmed** (reproduced locally or read directly in source) or **Assumption** (requires production verification). Nothing here comes from production data.

---

### R-1. Hardcoded default admin credentials, auto-restored on every server boot
- **Severity:** Critical
- **Status:** Confirmed (source + live reproduction)
- **Business impact:** Full, unauditable administrator access (users, financial reports, backups, settings) to anyone who knows or guesses `admin@lacuevita.com` / `admin123`. Because `lib/init-db.ts` force-promotes this exact email to ADMIN on every boot, and re-creates it with this exact password if no ADMIN exists, **remediating this account does not stick** — the next deploy/restart silently undoes any lockdown.
- **Evidence:** `prisma/seed.ts:12-22` (`bcrypt.hash("admin123", 12)`); `lib/init-db.ts:232-247` (hardcoded `HARD_CODED_ADMINS = ["admin@lacuevita.com"]`, force `UPDATE ... SET role='ADMIN'`); `lib/init-db.ts:283-295` (auto-creates `admin@lacuevita.com`/`admin123` if `adminCount === 0`). Reproduced live: logged in successfully with these exact credentials against a freshly seeded local instance.
- **Affected files/components:** `prisma/seed.ts`, `lib/init-db.ts`, `instrumentation.ts`.
- **Recommended correction:** Remove the hardcoded email/auto-admin-creation logic from `lib/init-db.ts` entirely (or gate it behind an explicit `ALLOW_BOOTSTRAP_ADMIN=true` env var used only for first-ever deploy). Rotate the production `admin@lacuevita.com` password immediately and force a password reset for every seeded account. Add a startup check that **alerts** rather than **silently fixes** if zero ADMIN users exist.
- **Complexity:** Low (delete/gate ~20 lines); the credential rotation itself is a same-day action.

### R-2. Payment recording is completely non-functional
- **Severity:** Critical
- **Status:** Confirmed (live reproduction — HTTP 404)
- **Business impact:** Nobody has been able to record a payment through the intended UI workflow for the entire first week. Any "payments" your team believes they've recorded either didn't save, or were made through the workaround of directly editing `paidAmount` on the invoice (which has its own problems — see R-4). The `Payment` table — which the app's own PDF/report code expects to read payment history from — is effectively unused.
- **Evidence:** Frontend calls `POST /api/invoices/customer/{id}/payments`, `PATCH .../payments/{paymentId}`, `DELETE .../payments/{paymentId}` (`app/(dashboard)/invoices/customer/[id]/page.tsx:225-296`). No matching route file exists anywhere under `app/api/invoices/customer/[id]/**`. Reproduced live: `curl -X POST http://localhost:3100/api/invoices/customer/{id}/payments` → HTTP 404.
- **Affected files/components:** Missing `app/api/invoices/customer/[id]/payments/route.ts` and `.../payments/[paymentId]/route.ts`; `Payment` Prisma model; `lib/backup.ts` (reads an empty table).
- **Recommended correction:** Build the missing payment endpoints: create a `Payment` row scoped to the invoice, recompute `paidAmount`/`paymentStatus` from the sum of payments (not a client-editable field), validate against remaining balance, and write an audit log entry. Until fixed, tell the team explicitly not to rely on the "Add Payment" button — use of the direct `paidAmount` field edit (with manual double-checking) is the only currently-working path.
- **Complexity:** Medium — a few days of focused work, given the schema already supports it.

### R-3. Audit logging is completely non-functional; build errors are deliberately suppressed
- **Severity:** Critical
- **Status:** Confirmed (schema check + `tsc --noEmit` + live `\dt`)
- **Business impact:** There is no record of who created, edited, deleted, voided, or marked-paid any financial document for the entire first week — the exact "immutable audit log" control this audit was commissioned to verify does not exist at runtime, despite a full admin UI (`/admin/audit-log`) pretending it does. The same gap disables `BackupLog` (backup history) and the entire 1099-contractor feature (missing `Supplier.taxId`, `is1099Contractor`, `w9OnFile`, etc.).
- **Evidence:** `prisma/schema.prisma` has no `AuditLog` or `BackupLog` model (git-bisected: dropped in merge `5a82fb0`, "keeping accounting-only schema," never restored even though `3db8a2d` built the whole audit-log feature on top of it). `npx tsc --noEmit` → 32 errors, including `Property 'auditLog' does not exist on type 'PrismaClient'` (`lib/audit.ts:34`, `app/api/admin/audit-log/route.ts:46,85,91`) and `Property 'backupLog' does not exist` (`app/api/admin/backups/route.ts`, `app/api/admin/backups/cron/route.ts`). `next.config.ts:8-14` explicitly sets `ignoreBuildErrors: true` / `ignoreDuringBuilds: true` with a comment acknowledging this exact gap. Reproduced live: fresh `prisma db push` from the current schema produces a database with **no** `AuditLog`/`BackupLog` tables (`psql \dt` output captured).
- **Affected files/components:** `prisma/schema.prisma`, `lib/audit.ts`, `app/api/admin/audit-log/**`, `app/api/admin/backups/**`, `app/api/admin/1099/**`, `app/api/suppliers/[id]/route.ts`, `next.config.ts`.
- **Recommended correction:** Restore the `AuditLog` and `BackupLog` models (and the missing 1099 `Supplier` columns) to `schema.prisma`, migrate production, then re-enable `ignoreBuildErrors`/`ignoreDuringBuilds: false` so this class of defect can never ship silently again. Also note: **no route currently calls `writeAuditLog` for `CustomerInvoice` create/update/delete at all** (see R-6) — restoring the table alone does not give you an invoice audit trail.
- **Complexity:** Medium — schema + migration is small, but auditing every write path that should log and doesn't (R-6) is more work.

### R-4. No server-side cap on `paidAmount` — overpayment accepted silently
- **Severity:** High
- **Status:** Confirmed (live reproduction)
- **Business impact:** Any user who can edit an invoice (including SALES on their own invoices) can set `paidAmount` to any value, including far more than the invoice total, with no error and no approval step. Reported "Accounts Receivable" and "Paid" totals cannot be trusted until this is fixed and historical data is checked.
- **Evidence:** `app/api/invoices/customer/[id]/route.ts:199-206` computes `paymentStatus` from `paidAmount` but never validates `paidAmount <= totalAmount`. Reproduced live: `PATCH` with `{"paidAmount":"500.00"}` on a $64.92 invoice → `200 OK`, `paymentStatus: "PAID"`.
- **Affected files/components:** `app/api/invoices/customer/[id]/route.ts`.
- **Recommended correction:** Reject (or route to a documented "credit balance" state) any `paidAmount + downPayment` that exceeds `totalAmount`. This should really be superseded by fixing R-2 (derive `paidAmount` from summed `Payment` rows instead of a directly-editable field).
- **Complexity:** Low.

### R-5. Unauthenticated and under-authorized diagnostic endpoints leak infrastructure data and write to production
- **Severity:** Critical
- **Status:** Confirmed (live reproduction)
- **Business impact:** `/api/debug` requires no authentication at all (explicitly whitelisted in `middleware.ts`) and returns database host/port/database name, whether `AUTH_SECRET` is configured and its exact length, `NEXTAUTH_URL`, and — on failure — the raw database connection error string. `/api/test-db` requires a valid session cookie but performs **no role or auth check in the handler itself**, returns the complete column list for `Customer` and `Supplier` tables, and **creates and deletes a live row in the production `Customer` table on every single GET request**.
- **Evidence:** `middleware.ts:3-9` (`/api/debug` in `PUBLIC_PATHS`); `app/api/debug/route.ts` (leaks listed above); `app/api/test-db/route.ts:1-45` (no `auth()` call, `prisma.customer.create({data:{name:"__test__"}})` then delete). Reproduced live: unauthenticated `curl /api/debug` returned full payload; authenticated `curl /api/test-db` returned `"customerCreate":"ok"` and full column lists.
- **Affected files/components:** `app/api/debug/route.ts`, `app/api/test-db/route.ts`, `middleware.ts`.
- **Recommended correction:** Delete both routes, or gate them behind `ADMIN` role + a non-production-only env flag. Remove `/api/debug` from `PUBLIC_PATHS`. Under no circumstances should a diagnostic GET endpoint perform a live write against a production table.
- **Complexity:** Low (delete two files, one middleware line).

### R-6. No audit trail on the single most sensitive entity, independent of R-3
- **Severity:** High
- **Status:** Confirmed
- **Business impact:** Even after `AuditLog` is restored (R-3), customer invoice create/update/delete still won't be logged, because the route never calls `writeAuditLog` in the first place — unlike the supplier, user, and backup routes, which do.
- **Evidence:** `app/api/invoices/customer/[id]/route.ts` and `app/api/invoices/customer/route.ts` contain zero references to `writeAuditLog`, versus `app/api/suppliers/[id]/route.ts` which calls it on every mutation.
- **Affected files/components:** `app/api/invoices/customer/route.ts`, `app/api/invoices/customer/[id]/route.ts`.
- **Recommended correction:** Add `writeAuditLog` calls (with before/after diffs via the existing `diffChanges` helper) to every customer-invoice create, update, and delete.
- **Complexity:** Low–Medium.

### R-7. Invoice numbering is not atomic, not globally unique, and freely editable
- **Severity:** High
- **Status:** Confirmed
- **Business impact:** Duplicate invoice numbers and sequence gaps — one of the six explicit "highest-priority controls" named in the audit brief — are achievable today, not hypothetical. Two concurrent invoice creations (or a double-click) can both read the same "next number." Uniqueness is only enforced per-customer. Any user who can edit an invoice can also freely retype `invoiceNumber`.
- **Evidence:** `app/api/invoices/customer/next-number/route.ts:11-20` computes `MAX(seq)+1` via a read-only query rather than an atomic increment, and completely ignores `CompanyProfile.customerInvoiceNextSeq`/`customerInvoiceNextSeq` (schema fields that exist for exactly this purpose and are referenced nowhere else in the codebase). `prisma/schema.prisma:99` — `@@unique([invoiceNumber, customerId])` is per-customer, not global. `app/api/invoices/customer/[id]/route.ts:9,114` — `invoiceNumber` is a freely-editable optional field on `PATCH` with no role gate.
- **Affected files/components:** `app/api/invoices/customer/next-number/route.ts`, `prisma/schema.prisma`, `app/api/invoices/customer/[id]/route.ts`.
- **Recommended correction:** Use `CompanyProfile.customerInvoiceNextSeq` with an atomic `UPDATE ... RETURNING` (or a DB sequence) to allocate numbers; make `invoiceNumber` immutable after creation except via an explicit admin "renumber" action that is audit-logged.
- **Complexity:** Medium.

### R-8. Core workflows advertised in the UI don't exist on the backend: send-by-email, void, refund, customer pay-portal
- **Severity:** High
- **Status:** Confirmed
- **Business impact:** "Send invoice by email" (button calls `POST /api/invoices/customer/{id}/send` — no such route exists), the public customer-facing pay/view page (`/pay`, whitelisted in `middleware.ts`, backed by the `viewToken` field on `CustomerInvoice` — no such page exists), voiding a document, and refunds/credits are all either missing entirely or silently broken. Only a hard, permanent `DELETE` exists in place of void.
- **Evidence:** `find app -name route.ts` / directory listing shows no `send`, `payments`, or `[id]` route under any pay-related path; no `app/pay/**` directory exists at all despite `middleware.ts:6` public-listing `/pay`; `lib/permissions.ts` defines a `void` action for `customer_invoice` that has no corresponding endpoint anywhere.
- **Affected files/components:** Entire "send," "pay portal," "void," "refund" surface area — none of it exists server-side.
- **Recommended correction:** Either build these features or remove the dead UI affordances (buttons, permission-matrix entries, `viewToken` field, `/pay` middleware carve-out) so the app doesn't claim capabilities it doesn't have. Prioritize "send by email" and "void" as these are core accounting-department expectations.
- **Complexity:** Medium–High (multiple features).

### R-9. No optimistic concurrency control on invoice edits
- **Severity:** Medium
- **Status:** Confirmed
- **Business impact:** Two users editing the same invoice at the same time will silently overwrite each other with no warning, no merge, no conflict log — directly the scenario the audit brief asked to be tested (Phase 4, #15).
- **Evidence:** `CustomerInvoice` has no version/`updatedAt`-check field consulted by `PATCH app/api/invoices/customer/[id]/route.ts` before writing.
- **Affected files/components:** `app/api/invoices/customer/[id]/route.ts`, `prisma/schema.prisma`.
- **Recommended correction:** Add a `version` int column, require the client to send back the version it read, reject stale writes with 409.
- **Complexity:** Medium.

### R-10. No rate limiting or MFA anywhere in the codebase
- **Severity:** Medium
- **Status:** Confirmed
- **Business impact:** Login brute-forcing (especially relevant given R-1's guessable default credentials) is entirely unmitigated. No lockout after repeated failures, no MFA option for any role including ADMIN.
- **Evidence:** Repo-wide search for rate-limiting patterns returned nothing; `lib/auth.ts:17-32` has no failure counter or delay.
- **Affected files/components:** `lib/auth.ts`, `auth.config.ts`.
- **Recommended correction:** Add per-IP/per-account throttling (e.g., a `LoginAttempt` table or an edge-level rate limiter) and, at minimum, a TOTP-based MFA option for ADMIN/MANAGER roles.
- **Complexity:** Medium.

### R-11. File-upload validation trusts client-supplied MIME type and filename independently
- **Severity:** Medium
- **Status:** Confirmed (code-level; not exploited live this pass)
- **Business impact:** A file can be uploaded with an allowed declared MIME type (e.g. `image/png`) but an arbitrary extension taken from the attacker-controlled filename (e.g. `.html`), then served statically from `public/uploads` — a plausible stored-XSS path since Next's static file server infers content-type from extension, not from the value validated at upload time.
- **Evidence:** `lib/upload.ts:26-33` (`validateFile` checks `file.type` only), `lib/upload.ts:35-46` (`saveFile` derives the stored extension from `file.name`, never cross-checked against the validated MIME type).
- **Affected files/components:** `lib/upload.ts`, `app/api/upload/route.ts`.
- **Recommended correction:** Derive the stored extension from the validated MIME type (allow-list mapping), not from the client filename; consider serving uploads through a route that forces `Content-Disposition: attachment` and a locked-down `Content-Type` instead of Next's static file handler.
- **Complexity:** Low.

### R-12. Deploy start command runs `prisma db push --accept-data-loss` on every restart
- **Severity:** Medium (High if combined with an uncoordinated schema edit)
- **Status:** Confirmed (config), impact unverified against actual production data
- **Business impact:** Every container restart re-syncs the live schema to whatever is currently in `prisma/schema.prisma`, with data loss pre-approved and no backup-first step. Given the schema is already known to be out of sync with application expectations (R-3, R-6), this is actively dangerous the next time someone edits the schema without full awareness of what's already relying on the old shape.
- **Evidence:** `railway.json:6-11` — `"startCommand": "npx prisma db push --accept-data-loss ; npm start"`.
- **Affected files/components:** `railway.json`.
- **Recommended correction:** Move to `prisma migrate deploy` with reviewed, versioned migrations; run schema changes as an explicit release step, not on every boot; never use `--accept-data-loss` unattended.
- **Complexity:** Low to change the command; Medium to build out a real migration history from the current `db push`-only state.

### R-13. Silent, unlogged bulk data correction on every server boot
- **Severity:** Medium
- **Status:** Confirmed
- **Business impact:** `lib/init-db.ts` recomputes and overwrites `paymentStatus` for every `CustomerInvoice` row on every boot via a raw, unlogged `UPDATE`. The logic is plausible, but doing it silently, with no audit trail and no visibility into what changed, is itself an integrity/traceability gap.
- **Evidence:** `lib/init-db.ts:210-230`.
- **Affected files/components:** `lib/init-db.ts`.
- **Recommended correction:** Move this to an explicit, audit-logged admin action ("Recalculate payment statuses") rather than an implicit boot-time side effect; if kept automatic, log every row changed.
- **Complexity:** Low.

### R-14. Conflicting deploy health-check configuration
- **Severity:** Low
- **Status:** Confirmed
- **Business impact:** `railway.json` (`healthcheckPath: "/"`) and `railway.toml` (`healthcheckPath: "/api/health"`) disagree; unclear which Railway actually honors, risking a false-positive health status.
- **Evidence:** `railway.json:9`, `railway.toml:2`.
- **Recommended correction:** Consolidate into a single config file, point at `/api/health`.
- **Complexity:** Trivial.

### R-15. Permission-matrix / route-enforcement mismatch
- **Severity:** Low
- **Status:** Confirmed
- **Business impact:** `lib/permissions.ts` declares `customer_invoice.delete` allowed for both `ADMIN` and `MANAGER`, but `DELETE app/api/invoices/customer/[id]/route.ts:223` checks `isAdmin(session)` directly — MANAGERs who believe they can delete an invoice per the documented policy will be silently denied. Not a vulnerability (more restrictive than declared), but a sign the permission matrix isn't the actual source of truth it claims to be, which will bite the next feature that copies the wrong pattern.
- **Evidence:** `lib/permissions.ts:11`, `app/api/invoices/customer/[id]/route.ts:217-228`.
- **Recommended correction:** Route every permission check through `requirePermission()`/`can()` consistently instead of ad hoc `isAdmin()`/role-string checks.
- **Complexity:** Low.
