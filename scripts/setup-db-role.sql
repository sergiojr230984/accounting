-- ============================================================================
-- La Cuevita Accounting — least-privilege Postgres role setup.
--
-- Run this ONCE in Railway → Postgres → Data tab → Query window, as the
-- default owner role that Railway provisions. After this runs successfully,
-- update DATABASE_URL in Railway → Variables to use the accounting_app
-- credentials instead of the owner role.
--
-- This role can SELECT/INSERT/UPDATE/DELETE on every existing and future
-- table in the public schema, but cannot DROP TABLE, ALTER SCHEMA, or
-- otherwise damage the schema even if its credentials leak.
-- ============================================================================

-- 1. Pick a strong password (replace REPLACE_ME_STRONG_PASSWORD below) and
-- create the role.
CREATE ROLE accounting_app LOGIN PASSWORD 'REPLACE_ME_STRONG_PASSWORD';

-- 2. Allow it to connect to the database and use the public schema.
GRANT CONNECT ON DATABASE railway TO accounting_app;
GRANT USAGE ON SCHEMA public TO accounting_app;

-- 3. Grant CRUD on every existing table + sequence in public.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO accounting_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO accounting_app;

-- 4. Make the same grants apply to tables/sequences added later (so any new
-- model from init-db.ts inherits the policy automatically).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO accounting_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO accounting_app;

-- 5. Sanity check — should return 'accounting_app' rows for each table.
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'accounting_app'
ORDER BY table_name, privilege_type
LIMIT 20;
