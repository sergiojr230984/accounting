/**
 * Schema drift check: proves that lib/init-db.ts's SCHEMA_STATEMENTS (the
 * hand-written SQL production actually runs on every boot) builds the same
 * database that prisma/schema.prisma describes (what `prisma generate` and
 * the whole test suite run against).
 *
 * Why this exists: tests provision their DB with `prisma db push`, so they
 * never execute init-db.ts at all. A model/column added to schema.prisma
 * without a matching init-db.ts entry passes every test and then 500s in
 * production -- CHANGELOG.md records that happening twice (Estimate, then
 * AuditLog). This closes that gap.
 *
 * What it does, against a throwaway database it creates and drops itself:
 *   1. Runs every SCHEMA_STATEMENT on an empty DB -- any error fails.
 *   2. Runs them all again -- any error fails (production re-runs them on
 *      every boot, so each must be idempotent).
 *   3. `prisma migrate diff` the result against schema.prisma -- any
 *      difference fails, and the SQL needed to reconcile is printed.
 *
 * Usage: DATABASE_URL=postgresql://... npx tsx scripts/check-schema-drift.ts
 * DATABASE_URL is only used to reach the server to CREATE/DROP the scratch
 * database. Refuses to run against anything that looks hosted/production.
 */
import { execFileSync } from "child_process";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { SCHEMA_STATEMENTS } from "../lib/init-db";

const SCRATCH_DB = "schema_drift_check";

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function main() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DATABASE_URL is not set.");
  if (/railway\.(app|internal)|rlwy\.net|amazonaws|rds\./.test(baseUrl)) {
    throw new Error("Refusing to run: DATABASE_URL looks like a hosted/production database.");
  }

  const scratchUrl = withDatabase(baseUrl, SCRATCH_DB);
  const admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);

  const failures: string[] = [];
  const scratch = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
  try {
    for (const pass of ["fresh database", "re-run (idempotency)"]) {
      for (const [i, stmt] of SCHEMA_STATEMENTS.entries()) {
        try {
          await scratch.$executeRawUnsafe(stmt);
        } catch (e) {
          const msg = (e as { meta?: { message?: string } }).meta?.message ?? String(e);
          failures.push(`[${pass}] statement #${i}: ${msg}\n    ${stmt.split("\n")[0].trim().slice(0, 120)}`);
        }
      }
    }
  } finally {
    await scratch.$disconnect();
  }

  let diff = "";
  let drifted = false;
  try {
    execFileSync(
      "npx",
      [
        "prisma", "migrate", "diff",
        "--from-url", scratchUrl,
        "--to-schema-datamodel", "prisma/schema.prisma",
        "--script", "--exit-code",
      ],
      { cwd: path.resolve(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    if (err.status === 2) {
      drifted = true;
      diff = err.stdout ?? "";
    } else {
      throw new Error(`prisma migrate diff failed to run:\n${err.stderr ?? e}`);
    }
  }

  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
  await admin.$disconnect();

  if (failures.length) {
    console.error(`\n✗ ${failures.length} init-db.ts statement(s) errored:\n\n${failures.join("\n\n")}\n`);
  }
  if (drifted) {
    console.error(
      "\n✗ lib/init-db.ts no longer builds the schema in prisma/schema.prisma.\n" +
        "  Production would be missing/different by the following. Add the equivalent\n" +
        "  idempotent statement(s) to SCHEMA_STATEMENTS (or fix schema.prisma):\n\n" +
        diff
    );
  }
  if (failures.length || drifted) process.exit(1);
  console.log(`✓ init-db.ts (${SCHEMA_STATEMENTS.length} statements, run twice) matches prisma/schema.prisma.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
