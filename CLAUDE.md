# La Cuevita Accounting — guardrails for future changes

This is a **live production system tracking real money** for a real
business. Several real bugs have made it to production because a fix was
applied to one place but not everywhere the same logic was duplicated, or
because a shared component was changed for one caller without checking who
else uses it. Read this before touching anything in `app/api/invoices/`,
`app/api/estimates/`, `components/InvoiceItemsEditor.tsx`, or `lib/money.ts`.

## Before you consider any change done

1. **Run the full suite, not just the area you touched:** `npm test`
   (equivalent to `npx vitest run`). It needs a real Postgres instance —
   see `tests/setup/global-setup.ts` for what it expects
   (`DATABASE_URL`, `AUTH_SECRET`, `UPLOAD_DIR`). Don't consider a fix
   verified until this is green (aside from
   `tests/uploads.test.ts`'s one documented `it.fails()` — that's a known,
   intentionally-undone gap, not a regression).
2. **Run `npx tsc --noEmit`.** Clean, no exceptions.
3. **A GitHub Actions workflow (`.github/workflows/ci.yml`) runs both of
   these automatically on every push and PR.** It flags a regression with
   a red X on the commit/PR — but it does NOT by itself block a merge.
   Ask a human to turn on branch protection on `main`
   (Settings → Branches → require this status check to pass before
   merging) if that hasn't been done, since Railway auto-deploys `main`
   straight to production with no other gate in front of it.
4. For anything touching money (subtotal/tax/fee/total math, payment
   status, invoice numbering), don't just read the code and reason about
   it — **reproduce the bug you're fixing with a failing test first**,
   then confirm the same test passes after the fix. "This looks right"
   is not verification on a system that keeps someone's real books.

## The #1 recurring failure pattern: fix applied once, needed everywhere

This app has (deliberately) near-identical logic duplicated across
**customer invoices, supplier bills, and estimates** — each has its own
create route, edit route, and sometimes its own page component. Every
serious bug found in this codebase's history follows the same shape: a fix
or feature landed for invoices and was never carried over to estimates (or
vice versa), because nothing forced the second file to be touched.

**Whenever you change:**
- Line-item subtotal/tax rounding math → touches all 6 of:
  `app/api/invoices/customer/route.ts`, `.../customer/[id]/route.ts`,
  `.../supplier/route.ts`, `.../supplier/[id]/route.ts`,
  `app/api/estimates/route.ts`, `.../estimates/[id]/route.ts`.
  **Don't reimplement this inline** — call `computeLineTotals()` from
  `lib/money.ts`, which all six already use. If you need different
  rounding behavior, change it there once, not six times.
- `components/InvoiceItemsEditor.tsx`'s props or behavior → check every
  caller: `invoices/customer/new`, `invoices/customer/[id]`,
  `invoices/supplier/new`, `invoices/supplier/[id]`, `estimates/new`,
  `estimates/[id]`. A prop this component now depends on (like `setValue`)
  is useless if only some callers pass it.
- The applied-fee cap/validation logic in
  `app/api/invoices/customer/route.ts` and `.../customer/[id]/route.ts` →
  these two currently stay in sync by hand; there's no shared helper for
  this one yet. Grep for `feeBase.times(canonical.rate)` in both files.
- Anything about invoice/estimate numbering → shared already in
  `lib/next-number.ts`'s `nextSequenceNumber()`. Don't duplicate the SQL.
- A guard/validation rule added to one document type as a security or
  correctness fix (e.g. "block edits after a payment exists", "reject
  overpayment", "scrub bank details for non-admin roles") → check whether
  the same rule was applied to the customer-invoice / supplier-bill /
  estimate sibling. If you deliberately leave one out, say so in the
  commit message so it doesn't look like an oversight later (see
  `tests/invoices.test.ts`'s "supplier bills still reject an overpayment"
  test for the pattern).

## API keys (`lib/api-key.ts`, `lib/api.ts`'s `requireReadAccess`/`requireReadAccessRole`)

External apps/dashboards authenticate with a bearer key instead of a session
cookie. This is deliberately **read-only by construction, not by role
check**: no POST/PATCH/DELETE handler anywhere in this codebase calls
`requireReadAccess`/`requireReadAccessRole` or otherwise checks for an API
key — those functions are only ever wired into GET handlers. That's the
actual security boundary. If you add a new GET endpoint that should be
reachable by external dashboards, wiring it up is fine and expected; if
you're ever tempted to accept an API key on a write route "just this once,"
stop — that breaks the one invariant the whole feature depends on, and
there is currently no scope/permission system on keys to fall back on.

Also: `middleware.ts` deliberately does NOT redirect unauthenticated
`/api/*` requests to `/login` (only page routes get that treatment) —
that's what lets a cookie-less API-key caller ever reach a route handler
at all. If you touch `middleware.ts`, re-run `tests/api-keys.test.ts`
specifically; a `hasSession` regression there silently breaks every
external integration with an HTML redirect instead of a JSON 401, and nothing else in the suite would catch it since every other test logs in first.

## Before removing, weakening, or skipping a test

If a test fails and the fix seems to be "change the test's expectation,"
stop and check whether that's actually right. Two tests in this suite
(`tests/invoices.test.ts`'s overpayment tests) were left permanently
failing for over a week after a deliberate behavior change, because
"those two always fail" got normalized instead of investigated — which
meant a genuinely new regression could have hidden behind them and no one
would have noticed. If a behavior change is intentional, update the test
to assert the new intended behavior (not just delete or skip it), and say
so explicitly in the commit message.

## Known, currently-accepted gaps (not regressions if you see them)

- `tests/uploads.test.ts`: any authenticated user can attach a file to
  any invoice, not just ones they're related to. Documented, not fixed.
- Supplier bills reject overpayment; customer invoices don't (intentional
  as of the customer-side change — see the "overpayment handling" describe
  block in `tests/invoices.test.ts`).
- `/api/reports` has no role restriction, unlike `/api/dashboard`.

If you fix any of these, remove this note and update/replace the test that
documents the gap.
