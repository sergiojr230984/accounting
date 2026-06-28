# La Cuevita Accounting — Setup & Operations Guide

## Quick Start

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in all required values.

3. Run the database migration:
   ```bash
   npx prisma migrate dev
   # or for production:
   npx prisma migrate deploy
   ```

4. Seed the database (creates a default Admin user):
   ```bash
   npm run db:seed
   ```

5. Start the dev server:
   ```bash
   npm run dev
   ```

---

## Role & Permission Matrix

`✅ full` · `👁 view only` · `🔒 own records only` · `❌ no access`

| Area | Employee (SALES) | Manager | Admin |
|---|---|---|---|
| Dashboard | 🔒 own sales widget | ✅ operational | ✅ full |
| Customer invoices — read/create/update | ✅ | ✅ | ✅ |
| Customer invoices — delete/void | ❌ | ✅ | ✅ |
| Customers | ✅ create/edit | ✅ create/edit/delete | ✅ |
| Products & Services | 👁 | ✅ | ✅ |
| Supplier bills | ❌ | ✅ | ✅ |
| Suppliers | ❌ | ✅ | ✅ |
| Contractor TIN / 1099 | ❌ | 👁 (no TIN) | ✅ |
| Reports: Income / Expense / Outstanding | ❌ | ✅ | ✅ |
| Reports: P&L, Balance Sheet, Cash Flow | ❌ | ❌ | ✅ |
| Settings | ❌ | ❌ | ✅ |
| User management | ❌ | ❌ | ✅ |
| Audit Log | ❌ | ❌ | ✅ |
| Backups | ❌ | ❌ | ✅ |

> The `SALES` role in the database corresponds to "Employee" in this matrix.

---

## Audit Log — Append-Only Enforcement

After running `prisma migrate deploy`, apply the DB-level revoke:

```bash
psql $DATABASE_URL -f prisma/migrations/audit_log_append_only.sql
```

Replace `app_user` in that file with the actual PostgreSQL role from your `DATABASE_URL`.

This ensures the application user can `INSERT` and `SELECT` on `AuditLog` but cannot `UPDATE` or `DELETE` rows, even if a bug or compromised package calls Prisma.

---

## TIN Encryption Setup

Contractor Tax Identification Numbers (TINs) are encrypted using **AES-256-GCM** before being stored in the database.

1. Generate a 32-byte key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Set it as `TIN_ENCRYPTION_KEY` in your environment (Railway → Variables).

> **Warning:** If you lose this key, encrypted TINs cannot be recovered. Back it up securely (password manager or secrets vault).

---

## Backups

### How backups work

- **Scheduled:** Configure your scheduler (Railway cron job, GitHub Actions, etc.) to `POST /api/admin/backups/cron` with the header `x-cron-secret: <BACKUP_CRON_SECRET>` daily at a low-traffic hour.
- **Manual:** Admin → Backups → "Backup Now".
- Backups are gzipped JSON files stored in `BACKUP_DIR` (default: `./backups`).
- If `BACKUP_S3_*` env vars are set, each backup is also uploaded to your S3-compatible bucket.

### Railway Cron Configuration

In Railway, add a Cron Job service:
```
POST https://your-app.up.railway.app/api/admin/backups/cron
Schedule: 0 2 * * *   (daily at 02:00 UTC)
Headers: x-cron-secret=<BACKUP_CRON_SECRET>
```

### Retention policy (GFS — Grandfather-Father-Son)

| Tier | Retained for |
|---|---|
| Daily backups | 30 days |
| Weekly backups | 12 weeks |
| Monthly backups | 12 months |

Pruning runs automatically after each backup.

---

## Restore Procedure

> **This procedure is destructive. It replaces all data. Test it in a non-production environment first.**

### Prerequisites
- A backup `.json.gz` file (from `BACKUP_DIR` or downloaded from S3).
- A fresh PostgreSQL database (same version or newer).
- The same `TIN_ENCRYPTION_KEY` used when the backup was created.

### Steps

1. **Provision a fresh database** (or clear the existing one).

2. **Set up the schema** on the new database:
   ```bash
   DATABASE_URL="<new-db-url>" npx prisma migrate deploy
   ```

3. **Decompress the backup file:**
   ```bash
   gunzip backup-YYYY-MM-DDT...json.gz
   # produces: backup-YYYY-MM-DDT...json
   ```

4. **Run the restore script:**
   ```bash
   node scripts/restore.js backup-YYYY-MM-DDT...json
   ```
   *(See `scripts/restore.js` for the importable restore helper — create this file for your specific stack as needed. It reads the JSON and calls `prisma.modelName.createMany()` for each table in dependency order.)*

5. **Re-apply the audit log append-only constraint:**
   ```bash
   psql $DATABASE_URL -f prisma/migrations/audit_log_append_only.sql
   ```

6. **Restore uploaded files:**
   Copy the contents of your old `UPLOAD_DIR` (or restore from S3) to the new `UPLOAD_DIR`.

7. **Verify:**
   - [ ] Log in as Admin.
   - [ ] Confirm customer and supplier invoice counts match the backup manifest.
   - [ ] Confirm the audit log is intact and append-only constraint is active.
   - [ ] Test a sample invoice PDF download to confirm uploaded files are accessible.

8. **Log the restore** in the Admin Backups UI (POST `/api/admin/backups` with `{ action: "restore", confirm: "RESTORE" }`).

---

## 1099 Contractor Setup

1. In **Suppliers**, edit a supplier and check **"1099 Contractor"**.
2. Fill in: Legal Name, Business Address, TIN (SSN/EIN), W-9 on File.
3. At year-end, go to **Admin → 1099 Contractors**, select the tax year, and export the CSV for your accountant.

> **Tax rule:** Payments made by credit/debit card are excluded from 1099-NEC totals (the card processor files 1099-K instead). Set `paymentMethod = card` on those payments. Confirm exclusion rules with your accountant annually.

---

## Environment Variables Reference

See `.env.example` for the full list. Required variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | NextAuth JWT secret (min 32 chars) |
| `TIN_ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM TIN encryption |
| `BACKUP_DIR` | Local directory for backup files |
| `BACKUP_CRON_SECRET` | Shared secret for the cron backup endpoint |

Optional (for S3 backup upload and email alerts):
- `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`
- `BACKUP_ALERT_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
