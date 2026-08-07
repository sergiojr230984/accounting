# Accounting Reconciliation — Initial Pass

**Important scope note:** I have no access to the production database, so this is **not** a reconciliation of your real first-week data. Phase 2/3's live reconciliation (recompute totals from actual production rows, compare to what the app displays, list every discrepant record ID) is **blocked** until read-only production DB access or an exported data dump is provided — see `WEEK_ONE_AUDIT_REPORT.md`'s "Access Limitations."

What follows is what I *could* verify: I stood up a disposable local PostgreSQL database, applied the repository's own `prisma/schema.prisma` and `prisma/seed.ts` exactly as production would on a fresh deploy, and exercised the calculation and payment logic through the real HTTP API (not mocked). All test data below is synthetic (`Audit Test Customer`, `audittest@example.com`) and has been deleted along with the entire test database.

## Calculations verified correct

| Check | Input | Expected | App result | Match? |
|---|---|---|---|---|
| Line total | qty `3` × unit price `19.99` | `59.97` | `59.97` | ✅ |
| Subtotal (single line) | line total `59.97` | `59.97` | `59.97` | ✅ |
| Tax (8.25%) | `59.97 × 0.0825 = 4.947525` | `4.95` (round-half-up to cents) | `4.95` | ✅ |
| Invoice total | `59.97 + 4.95` | `64.92` | `64.92` | ✅ |

`lib/money.ts` uses `decimal.js` with `ROUND_HALF_UP` and `Decimal(15,2)`/`Decimal(5,4)` column precision in the schema — this is the correct approach for currency math and avoids classic float-rounding bugs. No discrepancy found in this code path for the cases tested (single line item, single tax rate, no discounts). **Not yet tested:** multi-line invoices with mixed tax rates, line-item discounts, invoice-level discounts, shipping/service fees (`appliedFees` JSON field), credit-card fee surcharge (`creditCardFeeRate`), and commission-rate math — these should be exercised in a follow-up pass, ideally with real sample invoices from the first week once data access is available.

## Confirmed discrepancy: unvalidated overpayment

| Field | Value |
|---|---|
| Record | Locally-created test invoice `INV-2026-1001` (id `cmsi6xv5i0003iogjg0r9m5fu`, not present in production) |
| Expected result | `PATCH` with `paidAmount: 500.00` against a `totalAmount` of `64.92` should be rejected (payment cannot exceed balance) |
| Actual result | `HTTP 200`, `paidAmount: "500"`, `paymentStatus: "PAID"` — accepted with no validation |
| Financial difference | $435.08 of "payment" recorded with no corresponding funds — would inflate any "cash collected" or "revenue" report reading from this field |
| Likely root cause | `app/api/invoices/customer/[id]/route.ts` derives `paymentStatus` from `paidAmount` but never bounds `paidAmount` against `totalAmount` |
| Severity | High (see Risk Register R-4) |
| Recommended correction | Reject `paidAmount + downPayment > totalAmount` server-side; better, derive `paidAmount` from summed `Payment` records once R-2 is fixed, never from a directly client-writable field |

## Confirmed defect: the "record payment" workflow cannot produce any data to reconcile

Every attempt to use the intended payment-recording UI (`POST /api/invoices/customer/{id}/payments`) returns `HTTP 404` (reproduced live, see `TEST_RESULTS.md`). This means:
- The `Payment` table is not being populated by normal use of the app.
- Any historical "payments" your team believes exist were entered by directly editing the invoice's `paidAmount`/`downPayment` fields — a value with no supporting record of *when* each partial payment happened, *who* entered it, or *what method* was used.
- **Before any reconciliation of real production data is meaningful, this needs to be understood**: ask whoever has been recording payments this week exactly how they did it, since the intended feature was never functional.

## Proposed reconciliation procedure (once production access is available)

1. **Freeze writes** (or take a verified backup) before running anything.
2. Export `CustomerInvoice`, `CustomerInvoiceItem`, `Payment`, `Customer` as of the audit cutoff.
3. For every invoice: recompute `subtotal` = Σ(quantity × unitPrice), `taxAmount` = Σ(lineTotal × taxRate), `totalAmount` = subtotal + taxAmount + creditCardFee + Σ(appliedFees) — compare to stored values, flag any delta > $0.01.
4. For every invoice: recompute expected `paymentStatus` from `totalAmount − paidAmount − downPayment` using the exact same logic as `lib/init-db.ts`'s boot-time backfill (`<= 0` → PAID, `> 0` and `paidAmount/downPayment > 0` → PARTIALLY_PAID, else UNPAID) — compare to stored `paymentStatus`, flag mismatches (these would have been silently auto-corrected on the next server restart per R-13, so also diff against Railway deploy-log timestamps to see if/when that happened).
5. Cross-check `paidAmount` against the sum of any `Payment` rows that do exist for that invoice — given R-2, expect this sum to be far short of `paidAmount` for most/all invoices, since payments were entered by direct field edit, not through `Payment` rows.
6. List every invoice where `invoiceNumber` collides across different customers (allowed by the current unique constraint, see R-7) and every gap in the numeric sequence per prefix/year.
7. Sum `totalAmount` for all non-deleted `CustomerInvoice` rows this week and compare against whatever "revenue" figure has been reported to management informally — since there's no Estimate model, there should be no risk of unaccepted estimates being counted as revenue (that specific brief item doesn't apply to this app).
8. Produce a signed-off list of every record requiring manual correction, get management sign-off before writing any fix, and only then apply corrections — each one individually audit-logged once R-3/R-6 are fixed.

**Records requiring investigation:** none identified yet from production, because production has not been examined. Once access is granted, apply the procedure above and this section will be filled in with actual record IDs, expected vs. actual, and dollar deltas as the brief requires.
