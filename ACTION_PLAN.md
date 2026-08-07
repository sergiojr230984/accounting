# Action Plan

Ordered by urgency. Every item cites the corresponding Risk Register entry. No code has been changed as part of producing this plan — it is a proposal for sign-off before any production change is made, per the audit's working rules.

## Immediate — within 24 hours

1. **Rotate/lock down the default admin account** and confirm no one is currently relying on `admin@lacuevita.com` / `admin123` or `manager@lacuevita.com` / `manager123` in production. (R-1)
2. **Take a manual, verified backup of the production database now**, and confirm the backup file can actually be opened/restored to a scratch database — do this before touching anything else, and again immediately before any of the schema fixes below. (R-3, R-12; ties to Phase 7's "a backup is not reliable until restoration has been tested")
3. **Pull `/api/debug` and `/api/test-db` out of the deployed build** (feature-flag off or remove the routes) — they are live, reachable, and leaking infrastructure details and performing writes right now. (R-5)
4. **Tell the team, in writing, that "Add Payment" in the invoice screen does not work** and to stop relying on it until fixed — confirm with them how payments have actually been tracked this week so that data isn't lost or double-counted. (R-2)
5. **Confirm with whoever manages the Railway project** whether a persistent volume is mounted for `BACKUP_DIR`, and whether `BACKUP_S3_*` env vars are set — if neither, backups are not surviving redeploys and that needs an immediate stopgap. (Reliability finding)

## Within 7 days

6. **Restore the `AuditLog` and `BackupLog` Prisma models** (and the missing 1099 `Supplier` columns) to `schema.prisma`, migrate production properly (not via `db push --accept-data-loss`), and re-enable `typescript.ignoreBuildErrors: false` / `eslint.ignoreDuringBuilds: false` so this class of defect is caught by CI going forward. (R-3)
7. **Add `writeAuditLog` calls to customer-invoice create/update/delete** — the highest-value entity has none today, independent of the schema fix. (R-6)
8. **Build the missing payment endpoints** (`POST/PATCH/DELETE .../invoices/customer/{id}/payments[/…]`), deriving `paidAmount`/`paymentStatus` from summed `Payment` rows instead of a directly editable field, with server-side validation that payments can't exceed the remaining balance. (R-2, R-4)
9. **Remove the hardcoded admin bootstrap/force-promote logic** from `lib/init-db.ts`, or gate it behind an explicit one-time-use env flag so a legitimate admin lockdown can't be silently undone by the next restart. (R-1)
10. **Fix invoice numbering**: use the existing `CompanyProfile.customerInvoiceNextSeq` counter with an atomic increment, make `invoiceNumber` immutable post-creation except through an audited admin action. (R-7)
11. **Switch the Railway deploy from `prisma db push --accept-data-loss` to `prisma migrate deploy`** against a real, reviewed migration history. (R-12)
12. **Reconcile the last week's actual invoice/payment data** using the procedure in `ACCOUNTING_RECONCILIATION.md` once production read access is available — this needs to happen before management treats any of this week's reported totals as final.

## Within 30 days

13. **Implement void (with required reason) and refund/credit workflows** — currently only a hard, untracked `DELETE` exists. (R-8)
14. **Implement the customer-facing pay/view portal** (`/pay` + `viewToken`) and the "send invoice by email" route, or remove the UI affordances that currently promise these and don't deliver. (R-8)
15. **Add optimistic concurrency control** (a `version` column checked on every `PATCH`) to `CustomerInvoice` and `SupplierInvoice`. (R-9)
16. **Add login rate limiting and an MFA option** for ADMIN/MANAGER roles. (R-10)
17. **Fix file-upload extension/MIME-type handling** so the stored extension is derived from the validated MIME type, not the client-supplied filename. (R-11)
18. **Reconcile `railway.json`/`railway.toml`** into one source of truth for health checks and deploy commands. (R-14)
19. **Route every permission check through `lib/permissions.ts`'s `can()`/`requirePermission()`** instead of ad hoc role checks, so the documented policy matrix is actually the enforced one. (R-15)
20. **Run a full `npm audit` / dependency vulnerability pass** and a repo-wide secrets scan — not yet done in this session.

## Longer-term improvements

- Build the manager-approval workflow described in `MANAGEMENT_DASHBOARD_SPEC.md`: required approval for large discounts, deletions/voids, refunds, and edits to already-paid invoices.
- Build the daily reconciliation and management dashboard described in the same spec.
- Add a period-lock mechanism so closed accounting periods can't be silently edited.
- Move the raw-SQL bootstrap logic in `lib/init-db.ts` out of the request/boot path entirely and into reviewed, versioned Prisma migrations — the current triple schema-management approach (Prisma schema, raw SQL bootstrap, `db push` on every boot) is itself a standing risk of drift independent of any single bug fixed above.
- Consider adding automated integration tests for the invoice → payment → balance-zero lifecycle so a regression like R-2 (a fully 404'd core workflow) can't ship again unnoticed.
