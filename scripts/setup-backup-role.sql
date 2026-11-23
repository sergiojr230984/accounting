-- ============================================================================
-- La Cuevita Accounting — READ-ONLY role for the nightly off-site backup.
--
-- Run this ONCE in Railway → Postgres → Data tab → Query window, as the
-- default owner role Railway provisions (the same role that creates the
-- app's tables). Then put this role's connection string — using Railway's
-- PUBLIC (TCP proxy) host, since GitHub Actions runs outside Railway — in
-- the GitHub secret BACKUP_DATABASE_URL.
--
-- This role can only READ. If its credentials leak, the attacker can read
-- the books, but can't change or delete anything.
-- ============================================================================

-- 1. Replace REPLACE_ME_STRONG_PASSWORD with a long random password.
CREATE ROLE accounting_backup LOGIN PASSWORD 'REPLACE_ME_STRONG_PASSWORD';

-- 2. Connect + see the schema.
GRANT CONNECT ON DATABASE railway TO accounting_backup;
GRANT USAGE ON SCHEMA public TO accounting_backup;

-- 3. Read every existing table and sequence (pg_dump needs both).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO accounting_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO accounting_backup;

-- 4. Same for tables added later by lib/init-db.ts. (This applies to tables
-- created by the role running this script. If a table is ever created by a
-- different role, the backup FAILS with "permission denied" rather than
-- silently skipping it. Re-run step 3 to fix.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO accounting_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO accounting_backup;

-- 5. Sanity check: should list every table with privilege SELECT only.
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'accounting_backup'
ORDER BY table_name;
