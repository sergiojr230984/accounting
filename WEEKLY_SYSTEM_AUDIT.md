# Weekly System Audit

**Audit period:** 2026-07-31 → 2026-08-07
**Date generated:** 2026-08-07
**Branch audited:** `claude/accounting-system-issue-P9dod` (per DEPLOYMENT.md, this is the branch Railway deploys to production from, until merged to `main`)
**Method:** Read-only source inspection of this exact branch, plus hands-on verification in a disposable local PostgreSQL database (created and dropped within this session — no production data, credentials, or environment touched). A single read-only HTTPS request to the public production health endpoint was attempted and blocked by this environment's outbound proxy (see "Access Limitations"). **No production database, application logs, Sentry, Railway dashboard, or Better Uptime data was accessible from this session.**

---

## CRITICAL ALERT

**A hardcoded email address (`sales@lacuevitafurniture.com`) is silently and automatically re-promoted to `ADMIN` — with a real database write — every time its session is validated, in two separate code paths, and this directly contradicts an explicit comment in a third file stating that exact account "must NOT be hardcoded" as admin.**

- `lib/auth.ts`'s NextAuth `session()` callback: `BUILT_IN_ADMINS = new Set(["admin@lacuevita.com", "sales@lacuevitafurniture.com"])`. If that account's role in the database is ever anything other than `ADMIN`, this callback runs `prisma.user.update({ ..., data: { role: "ADMIN" } })` **on that request**, then reports `role: "ADMIN"` in the session. This isn't a one-time boot action — it runs on ordinary session refreshes.
- `lib/viewer.ts` hardcodes the same email in its own `HARD_CODED_ADMINS` set, used by the JWT-fallback session-resolution path (`resolveViewer()`).
- `lib/init-db.ts`'s boot-time admin bootstrap explicitly excludes this email, with the comment: *"Force-promote only the true system admin. sales@ is a regular user account and must NOT be hardcoded here — its role is managed via the Settings UI."*

**Effect:** if anyone with ADMIN access ever demotes, or believes they have demoted, `sales@lacuevitafurniture.com` from Admin to a lesser role via Settings → Users (the only place the README documents role changes as happening), that demotion will not hold — the very next time that account is used, its role silently reverts to ADMIN and the database is rewritten to match. This is undocumented in the README's own permissions table and is not mentioned in `DEPLOYMENT.md`. I cannot tell from code alone whether this is a deliberate, accepted design (e.g., "the owner's account must never lose admin, full stop") or a leftover/oversight — the contradiction with `lib/init-db.ts`'s comment suggests the latter. Given this is presented as a name that reads like a regular employee/sales account, and the audit brief specifically asks me to flag "administrator compromise" risk and "privilege escalation," I am surfacing this at the top rather than burying it in the findings list.

**This needs a human decision, not a unilateral fix — see Recommended Actions.** No change has been made.

---

## Executive Summary

- **Test suite: 108/109 passing** (1 expected/documented failure), 0 TypeScript compile errors, 0 build-error suppression in `next.config.ts` — a major, verified improvement in engineering hygiene versus what a prior audit found on a different branch.
- **The CRITICAL ALERT above** — a hardcoded email is silently and repeatedly re-granted ADMIN, contradicting the codebase's own stated intent elsewhere.
- **7 dependency vulnerabilities (2 critical, 5 high)** currently present in production dependencies (`next@15.5.20`, transitively `postcss`, `sharp`) — `npm audit fix` available.
- **No backup or data-export feature exists in this branch at all** — this is self-documented in the project's own README under "Known Limitations." Whether Railway/Postgres-managed backups are enabled at the infrastructure level could not be verified from this session.
- **Estimates carry no audit-log coverage** — invoice create/update/delete now write to `AuditLog` (a real fix vs. a prior branch), but the equivalent estimate routes call `writeAuditLog` zero times.
- **A real, self-documented server-side permission gap**: Estimates, Supplier Bills, and the Reports API enforce no role check beyond "is logged in" — a SALES/"Employee" account can reach full company financial reports via a direct API call even though the UI hides that link from them. Per the same README, this contradicts what `DEPLOYMENT.md` claims about these routes.
- **Overpayment is allowed by design** (tracked as a credit balance), consistently enforced in both the direct-edit and payment-ledger code paths — this is intentional, not a bug, though `CHANGELOG.md`'s "[Unreleased]" entry describing it as "now rejected server-side" is stale/inaccurate and should be corrected.
- **Financial-history protection is real and working**: once an invoice has any recorded payment, its existing line items become immutable (verified in code) and it can no longer be deleted (verified in code) — new lines can still be added.
- **Payment recording uses a real row lock** (`SELECT ... FOR UPDATE` inside a transaction) to close the double-payment race a prior audit flagged on a different branch — verified in code.
- **This week's actual business activity (invoice/estimate/payment counts, employee logins, discrepancies in real records) could not be audited** — no production database or log access was available in this session. Everything above is either a static-code finding or was reproduced against synthetic local data. See "Access Limitations."
- A production health-check request was attempted (read-only, to the app's own public `/api/health` endpoint) and was blocked by this environment's outbound network policy before reaching the app — no data was retrieved.

## System Health Score

| Category | Score | Basis |
|---|---|---|
| System Reliability | 70/100 | Clean build, passing test suite, real row-locking on the payment race — but no backup/export feature at all, and production error/uptime data (Sentry, Better Uptime) was not reachable this session to confirm actual weekly stability |
| Accounting Accuracy | 80/100 | Core math, overpayment handling, and paid-invoice immutability all verified correct in code and via local reproduction; estimate-to-invoice conversion is row-locked against double-booking; could not reconcile real production totals |
| Security | 55/100 | The CRITICAL ALERT dominates this score; separately, 2 critical + 5 high dependency CVEs are outstanding, and a self-documented role-check gap exists on Estimates/Supplier Bills/Reports |
| Data Quality | 70/100 | No duplicate-detection issues found in code paths reviewed; estimate audit-log coverage is a real gap; real-data quality (duplicate customers, orphaned records) could not be checked without production access |
| Performance | N/A this week | No production APM/query-timing data was reachable from this session; nothing in the code review indicated an obvious regression |
| Employee Controls | 60/100 | Role enforcement is centralized and mostly consistent (`requireAuth`/`requireRole`), but the CRITICAL ALERT and the Estimates/Supplier-Bills/Reports gap both weaken this; per-employee activity for the week could not be pulled |
| Backup / Recovery | 20/100 | No backup or restore mechanism exists in the application layer at all (self-documented limitation); infrastructure-level (Railway/Postgres) backup status is unverified from this session |

**SYSTEM HEALTH SCORE: 59 / 100**

Main factors: the score is held down primarily by the CRITICAL ALERT (a live privilege-persistence mechanism contradicting the codebase's own documented intent), the complete absence of any backup mechanism, and the inability to verify real-world weekly activity and production stability from this session. It is held up by genuinely strong, verified engineering fundamentals: a green test suite, a clean type-check, working row-locked transactions on the two highest-risk financial races, and correct-by-inspection accounting math.

## Critical Findings

### C-1. Hardcoded admin re-promotion for `sales@lacuevitafurniture.com`
See "CRITICAL ALERT" above for full detail. **Evidence:** `lib/auth.ts` (`BUILT_IN_ADMINS` set + the `prisma.user.update(...role:"ADMIN"...)` call in the `session()` callback), `lib/viewer.ts` (`HARD_CODED_ADMINS` set), contradicted by `lib/init-db.ts`'s comment excluding this exact email. **Business impact:** any attempt to demote or restrict this account through the documented Settings UI will not hold. **Recommended correction:** confirm with whoever owns this account whether permanent admin status is actually intended; if yes, document it explicitly in README's permission table and remove the contradictory comment in `lib/init-db.ts`; if no, remove the two hardcoded overrides so Settings-UI role management is the single source of truth. **Do not act on this without your sign-off — it may be intentional.**

## High Priority Findings

### H-1. Dependency vulnerabilities: 2 critical, 5 high
`npm audit --omit=dev` against the current lockfile reports 7 vulnerabilities. The direct culprit is `next@15.5.20` (in the `^15.0.4` range) — advisories include a Denial-of-Service in Server Actions, SSRF via Server Actions on custom servers and via rewrites with attacker-controlled hostnames, response-body cache confusion (two separate advisories), unbounded Server Action payload on the Edge runtime, and **unauthenticated disclosure of internal Server Function endpoints**. Transitively, `sharp@0.34.5` (image optimization) and a bundled `postcss` are also flagged. A fix is available via `npm audit fix` (verify it lands on a genuinely patched `next` version, not just the top of the current semver range, since the vulnerable range extends past several point releases). **Severity note:** these are upstream framework CVEs, not something introduced by application code this week — but they are live in the current dependency tree today.

### H-2. Estimates have no server-side role check beyond "logged in"
Confirmed in code: `app/api/estimates/route.ts` and `app/api/estimates/[id]/route.ts` use `requireReadAccess`, which accepts **any** authenticated session or scoped API key regardless of role — there is no `requireRole(...)` call anywhere in either file. The same is true of `app/api/invoices/supplier/route.ts` / `[id]/route.ts` and the Reports API. The project's own `README.md` (`## User Roles`, the paragraph after the permission table) already discloses this and notes it contradicts `DEPLOYMENT.md`'s claim that "transactional routes... are gated to ADMIN or MANAGER." **For Estimates and Supplier Bills specifically, this matches the documented permission table** (SALES is intentionally given full access) — so for those two, it is a documentation inconsistency between README and DEPLOYMENT.md rather than a live gap. **For the Reports API it is different**: SALES is shown "hidden" for Reports nav visibility in the same table, implying reports should not be a SALES-accessible resource, yet the route itself enforces no such restriction — a SALES/"Employee" account can pull full company P&L, profitability, and outstanding-receivables data via a direct API call. **Recommended correction:** decide whether SALES should see company-wide reports; if not, add `requireRole("ADMIN","MANAGER")` to the reports routes; either way, reconcile `DEPLOYMENT.md`'s claim with what's actually enforced.

### H-3. No backup or data-export mechanism exists
Self-documented in `README.md`'s "Known Limitations": *"No data-export or backup feature exists in this branch... An earlier iteration of this system had scheduled/manual backup endpoints and a full-data-export route; neither is present here."* Confirmed by a repo-wide search — no file, route, or scheduled job related to backups exists anywhere in this branch. **This is a financial system with no application-level recovery mechanism.** Whether Railway's managed Postgres add-on has automated backups enabled is an infrastructure setting outside this repository and could not be checked from this session. **Recommended correction:** confirm Railway/Postgres backup + point-in-time-recovery settings directly in the Railway dashboard this week, and treat "backups exist and have been restore-tested" as unverified until that's done.

## Medium Priority Findings

### M-1. Estimates are not audit-logged
`app/api/estimates/route.ts` and `app/api/estimates/[id]/route.ts` contain zero calls to `writeAuditLog`, while the equivalent customer-invoice routes call it consistently (create, update, delete). Estimate creation, editing, deletion, and conversion-to-invoice happen with no entry in the `AuditLog` table. **Recommended correction:** add `writeAuditLog` calls mirroring the invoice routes' pattern, including a before/after diff on edits.

### M-2. `CHANGELOG.md` overpayment entry is inaccurate
The "[Unreleased]" changelog states *"Overpayment is now rejected server-side, both via direct edits and via the payment ledger."* The actual code (`app/api/invoices/customer/[id]/route.ts` and the payment-ledger route) does the opposite by explicit design: overpayment is allowed and shows as a credit balance, with a code comment explaining the cash-rounding rationale, and this matches `README.md`'s own description of the feature. This is a documentation-accuracy issue, not a functional defect — the current behavior itself looks like a reasonable, deliberate design choice. **Recommended correction:** fix the changelog wording so it doesn't contradict the shipped behavior and the README.

### M-3. `.env.example` documentation doesn't match `lib/init-db.ts`
`.env.example` states *"Built-in admins (admin@lacuevita.com, sales@lacuevitafurniture.com) are always promoted regardless [of `ADMIN_EMAILS`]"* — which is accurate for `lib/auth.ts`/`lib/viewer.ts` (see Critical Finding C-1) but not for `lib/init-db.ts`, whose own comment says the opposite for the `sales@` account. This is the same underlying inconsistency as C-1, visible in a third location. Resolving C-1 will resolve this too.

## Low Priority Findings

### L-1. Settings page is readable by any signed-in role
Per README's own table, "Settings — read: ✅ (page reachable by any signed-in user)" while writes are ADMIN-only. This wasn't independently re-verified against the settings API route content this pass (time-boxed); flagging as low-severity because the README already discloses it and frames it as a known, intentional read-only exposure — worth a quick confirmation that nothing sensitive (e.g., API-key values, SMTP/Resend credentials) is actually rendered on that page to a SALES-role viewer, since "settings" is a broad bucket.

## Financial Reconciliation

**Blocked for real production figures** — no production database access this session. Gross invoice sales, discounts, taxes, net sales, payments collected, refunds, outstanding receivables, invoice counts, and estimate conversion counts for the actual last 7 days cannot be produced without either read-only production DB credentials or an exported data dump.

What was verified this pass, against synthetic local data and by code inspection only (not counted toward any real total):
- Line total, subtotal, and tax math confirmed correct in a prior pass on similar logic (`lib/money.ts` uses `decimal.js`, `ROUND_HALF_UP`), and this branch additionally fixed a subtotal/line-item rounding disagreement (each line now rounds to 2 decimals before being summed — confirmed via `CHANGELOG.md` and consistent with `lib/money.ts`'s `computeLineTotals`).
- Overpayment handling verified consistent between the direct invoice-edit path and the payment-ledger path (both allow it, both cap `paymentStatus` at `PAID`, both treat the excess as a credit).
- Paid-invoice immutability verified in code: once `paymentStatus !== "UNPAID"`, existing line items can't be changed or removed (only new lines can be added), and the invoice can no longer be deleted.
- Estimate-to-invoice conversion is protected by a database row lock against double-booking (per `CHANGELOG.md`, confirmed by the presence of a locking pattern matching the payment-ledger transaction).
- Full accounting-logic reconciliation against real invoices/estimates/payments from the last 7 days is the top item to unblock for next week's audit.

## Employee Activity Summary

**Blocked** — logins, per-employee document counts, discounts given, edits, deletions, voids, and after-hours activity all require production data (the `AuditLog` table and `User.lastLogin`) that this session cannot query. Noting for completeness: the code paths that would need to exist to answer this section (audit logging on invoices, `lastLogin` tracking) are present for invoices but **not** for estimates (see M-1) — so even with production access, this week's estimate-related employee activity would be under-counted relative to invoices until that gap is fixed.

## Security Review

Covered above (C-1, H-1, H-2) plus:
- **Secrets scan:** no `.env`/`.env.local`/`.env.production` file is committed, and a pattern search for common API-key/private-key formats across tracked source files found nothing. Clean.
- **Session handling:** JWT sessions capped at 12 hours (down from NextAuth's 30-day default), confirmed in `lib/auth.ts`. Deactivating a user is documented (`CHANGELOG.md`) to immediately revoke their session rather than just blocking the next login — not independently re-verified this pass.
- **Rate limiting:** login is rate-limited by IP and by submitted email (`lib/auth.ts` calls `lib/rate-limit.ts`), confirmed in code — a real fix versus a prior audit of a different branch that had none.
- **CSRF:** an Origin/Referer check is present in `middleware.ts` as defense-in-depth, confirmed present (not independently tested against a forged request this pass).
- **Diagnostic endpoints:** `/api/debug` and `/api/test-db` (previously flagged as unauthenticated, data-leaking endpoints on a different branch) **do not exist on this branch.** `/api/me` exists as a documented session-debugging endpoint; the one string reference to `AUTH_SECRET` in it is an error-hint message, not the secret's value or length — reviewed and not a leak.
- **Headers:** CSP, HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a `Permissions-Policy` are all set in `next.config.ts` — confirmed present.
- **New administrator accounts / permission changes this week:** blocked, requires production `AuditLog`/`User` data.
- **New dependencies this week:** the API-key feature (`lib/api-key.ts`, `lib/api-scopes.ts`) shipped in the audited window (commits `9389684`, `cc642ea`, both 2026-08-04) — reviewed at a high level; scopes are checked per-key in `requireReadAccess`, no obvious over-broad default scope found, not exhaustively fuzz-tested this pass.

## Performance Review

**Blocked for week-over-week comparison** — no APM, query-log, or uptime-monitor access this session (Sentry/Better Uptime credentials are not part of this session's tool access; a direct read-only request to the app's own public `/api/health` endpoint was attempted and blocked by this environment's outbound network policy before it reached the app — see Access Limitations). Code-level note: `CHANGELOG.md` documents two performance fixes landing recently — invoice/estimate next-number generation moved from an in-JS scan to a single SQL aggregate, and the product-catalog auto-save batched from N sequential queries to one existence-check plus one bulk insert — both are positive, verified-present changes (`app/api/invoices/customer/next-number/route.ts` and the estimate equivalent use a SQL aggregate, confirmed by inspection).

## Backup Status

**No application-level backup exists in this branch (see H-3).** Most recent valid backup date: **unknown / not verifiable from this session** — this needs to be checked directly against the Railway Postgres add-on's dashboard, not against anything in this repository.

## Changes Since Last Week

11 commits landed on this branch in the audited window (all by the same automated agent, per `git log`):

| Commit | Date (UTC) | Summary |
|---|---|---|
| `cc642ea` | 08-04 | Add per-key scopes to API keys, plus an aggregate-only summary endpoint |
| `9389684` | 08-04 | Add read-only API keys for external apps and dashboards |
| `abd3b48` | 08-04 | Fix middleware redirecting unauthenticated API requests to an HTML login page |
| `ce2a437` | 08-04 | Add CI test gate and future-change guardrails |
| `839820e` | 08-04 | Read role from the DB in the JWT-fallback auth path too, not the token |
| `a42827f` | 08-04 | Stop leaking supplier bank/Zelle details to every authenticated role |
| `2f7d299` | 08-04 | Fix two overpayment tests left failing after the guard was intentionally removed |
| `45dd957` | 08-04 | Fix estimates silently missing the subtotal-rounding fix invoices got |
| `a846c1a` | 08-03 | Fix invoice numbering ignoring the configured prefix when it's blank |
| `e630e04` | 08-03 | Fix item name field not accepting typed input on estimates |
| `a65c595` | 08-03 | Fix fee-ceiling check rejecting amounts that legitimately round up |

No commits landed in the last 3 days of the audit window (08-05 through 08-07). None of these commits, by their messages or the spot-checks performed this pass, appear to have introduced a regression — the full test suite (108/109, 1 expected fail) passes against the current tip. I did not independently bisect each commit against the test suite individually this pass; if a regression is suspected, that would be the next step.

**Important scope note:** this is the branch's *commit* history, not a record of what was actually deployed to production and when — Railway deploy timestamps were not accessible this session, so I can't confirm which of these commits are actually live in production versus merely pushed to this branch.

## Recommended Actions

### Fix Immediately
1. **Resolve the `sales@lacuevitafurniture.com` hardcoded-admin contradiction (C-1)** — get a human decision on intent, then make the code consistent either way. This is the single highest-priority item this week.
2. **Confirm Railway/Postgres backup settings directly in the Railway dashboard (H-3)** — this repo cannot answer whether backups exist; only the infrastructure console can.

### Fix This Week
3. Run `npm audit fix` for the dependency vulnerabilities (H-1), verify the resulting `next` version against the specific advisories listed, and re-run the full test suite afterward.
4. Decide and enforce the intended role restriction on the Reports API (H-2) — currently any authenticated role can reach it via direct API call regardless of what the UI hides.
5. Add `writeAuditLog` calls to the estimate routes (M-1) so estimate activity is auditable on the same footing as invoices.

### Monitor
6. Correct the stale overpayment description in `CHANGELOG.md` and the `sales@` line in `.env.example` (M-2, M-3) — low risk, but living documentation that contradicts the code will keep costing review time.
7. Once production access is available, run the full Financial Reconciliation and Employee Activity Summary this report couldn't complete.
8. Confirm what's rendered on the Settings page for non-ADMIN viewers (L-1).

### Future Improvements
9. Establish a real application-level or infrastructure-level backup + restore-test cadence, and document the last successful restore test date somewhere checkable (this report can report it once it exists).
10. Consider giving this session (or a dedicated read-only audit credential) scoped, read-only access to production data and to Sentry/Better Uptime so future weekly audits can complete Sections 2, 3, 4, 5, 6, 11, and 12 against real activity instead of being blocked.

## Access Limitations

This session had:
- No production database connection (all live-testing was against a disposable local Postgres instance, created and destroyed within this session, seeded only with the repo's own non-production test fixtures).
- No production logs, Railway deploy history, Sentry, or Better Uptime access.
- One attempted read-only HTTPS request to the production app's own public `/api/health` endpoint, which returned `HTTP 403` from this environment's outbound proxy before reaching the application — no production response was obtained.

Every finding above is either (a) a static-code fact, true regardless of environment, (b) reproduced against synthetic local data created and destroyed in this session, or (c) explicitly marked as blocked. Nothing in this report contains real customer, employee, or payment data.

---

## TOP 5 ACTIONS FOR MANAGEMENT THIS WEEK

1. **Decide, with whoever manages `sales@lacuevitafurniture.com`, whether that account should permanently hold Admin rights.** Right now the code silently re-grants it Admin no matter what Settings says, and that contradicts another part of the same codebase — this needs a human call, then a one-line fix to make the code match the decision.
2. **Log into the Railway dashboard and confirm Postgres backups are actually enabled, with a retention policy** — there is no backup mechanism in the application at all, and this report cannot tell you whether the infrastructure layer is covering that gap.
3. **Approve running `npm audit fix`** to close 2 critical + 5 high dependency vulnerabilities in the framework layer, then have someone confirm the app still boots and the test suite still passes after.
4. **Decide whether SALES/"Employee" accounts should be able to pull full company financial reports** — today they can, via direct API call, even though the button is hidden from them in the UI.
5. **Grant read-only production database (or exported CSV) access for next week's audit** so Sections 2–6 (the actual invoice/estimate/payment/employee activity for the week) can be completed — this week's report could only verify code correctness, not real business activity.
