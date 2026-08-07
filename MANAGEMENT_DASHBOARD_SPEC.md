# Management & Employee Supervision — Dashboard Spec

This is a design proposal, not yet implemented. It's scoped for financial accountability and operational traceability — not employee surveillance. None of it should exist without the underlying audit log actually working (see Risk R-3/R-6, Action Plan #6-7) — everything below depends on that foundation being real first.

## Recommended metrics (daily dashboard)

- Invoices created, edited, voided, deleted — counts and $ totals, by employee.
- Payments recorded, modified, deleted — counts and $ totals, by employee.
- Estimates: **not applicable** — this app has no estimate/quote module.
- Discounts applied, by employee and by %, flagged if above the manager-approval threshold (see below).
- Refunds/credits issued (once R-8 is built).
- Outstanding accounts-receivable total, aged (0-30/31-60/61-90/90+ days).
- Overdue invoice count and $ total.
- Customer/supplier records created or edited today.
- Login count by user, failed-login count by user/IP (requires building the tracking this doesn't currently have — see Action Plan #16).
- Backup status: last successful backup timestamp, size, and whether the last restore test passed.

## Alerts

- Duplicate invoice number detected (should be structurally impossible once R-7 is fixed, but alert anyway as a safety net).
- Invoice deleted or voided.
- Payment deleted or amount modified after creation.
- Discount above the configured threshold (see below) applied without a recorded manager approval.
- Invoice edited after being marked PAID.
- Login activity outside configured business hours.
- Repeated failed login attempts on one account (ties to Action Plan #16 — rate limiting doesn't exist yet, this alert needs that groundwork).
- Backup job failure, or backup restore-test failure.
- `paidAmount` set to a value exceeding `totalAmount` (should be structurally impossible once R-4 is fixed, alert as a safety net regardless).

## Permissions (build on the existing `lib/permissions.ts` matrix, don't replace it)

The current `ADMIN` / `MANAGER` / `SALES` roles are a reasonable base. Recommended refinement:

| Action | SALES | MANAGER | ADMIN | Notes |
|---|---|---|---|---|
| Create/edit own invoices (unpaid/draft) | ✅ | ✅ | ✅ | current behavior |
| Edit an invoice already marked PAID | ❌ | Approval required | ✅ | new — currently unrestricted for SALES on their own invoices |
| Apply a discount above threshold (e.g. 15%) | Approval required | ✅ | ✅ | new — no threshold exists today |
| Delete/void an invoice | ❌ | Approval required (or reason-logged) | ✅ | currently DELETE is ADMIN-only in code but MANAGER-allowed in the permission matrix — resolve that inconsistency (R-15) as part of this work |
| Record a refund/credit | ❌ | Approval required | ✅ | feature doesn't exist yet (R-8) |
| Edit payment amount after creation | ❌ | Approval required, reason required | ✅ | feature doesn't exist yet (R-2) |
| View/export audit log | ❌ | Read-only | ✅ | matches current matrix intent, currently non-functional (R-3) |
| Manage users/settings/backups | ❌ | ❌ | ✅ | matches current matrix |

A separate, distinct "Accountant" role was suggested by the audit brief — recommend deferring this until the three existing roles are actually enforced consistently (R-15) rather than adding a fourth role on top of inconsistent enforcement.

## Approval workflows

- **Large discounts:** require a `MANAGER`+ approval before a discount above a configurable threshold (suggest starting at 15%, configurable in `CompanyProfile`) is saved — store the approver's user ID, timestamp, and reason alongside the invoice/line item.
- **Deletion or voiding:** require a typed reason (min length enforced) captured in the audit log entry; require `MANAGER`+ regardless of who created the record.
- **Editing a paid invoice:** require `MANAGER`+ approval and a reason; the audit log entry should capture the full before/after diff (the existing `diffChanges` helper in `lib/audit.ts` already does this — it just isn't called from the invoice routes yet, see R-6).
- **Refunds/payment edits:** same pattern — reason required, approver recorded, before/after values logged.

## Audit-log requirements

Once R-3/R-6 are fixed, every entry should carry (the `AuditLog`/`writeAuditLog` design in `lib/audit.ts` already supports all of this — it just needs the table restored and the missing call sites added):

- Actor (user ID, name, role) — already captured via `actorFromSession`.
- Action type (CREATE/UPDATE/DELETE/VOID/LOGIN/etc.) — already modeled.
- Entity type + ID + human-readable label.
- Before/after values for every changed field — already modeled via `diffChanges`.
- IP address + user agent — already captured via `extractMeta`.
- Timestamp — already modeled.
- The table should be **append-only at the database level** — `prisma/migrations/audit_log_append_only.sql` already contains the correct `REVOKE UPDATE, DELETE` statement; this just needs to actually be run once the table exists, and the optional hash-chain trigger in that same file is worth enabling for tamper-evidence given this is a financial system.

## Period locking

Not currently implemented anywhere in the codebase. Recommend a simple `LockedPeriod` concept (e.g., a month is locked after close), enforced server-side on every invoice/payment mutation — reject writes against a locked period unless the actor is `ADMIN` and supplies a reason, itself audit-logged.

## Exportable reports

`app/api/admin/export/route.ts` already exists as a starting point (currently audit-logs an `ACCESS_DENIED` on failure, per the grep during this audit) — extend it to include a daily reconciliation export (invoices issued, payments collected, refunds, discounts, deletions, outstanding balances) in CSV, matching the reconciliation procedure in `ACCOUNTING_RECONCILIATION.md`.
