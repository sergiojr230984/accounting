import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { SequenceField } from "./next-number";

// Caches the in-flight promise, not just a boolean -- a boolean flag set
// synchronously before the async work below completes would let a second
// caller (e.g. a route's own `await initializeDatabase()` racing the
// fire-and-forget call in instrumentation.ts) see "already started" and
// return immediately while table creation is still in progress, letting it
// query a table that doesn't exist yet. Every caller now awaits the same
// promise, so none can proceed until schema creation has actually finished.
let initPromise: Promise<void> | null = null;

const SCHEMA_STATEMENTS: string[] = [
  `DO $$ BEGIN CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SALES' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Role')) THEN ALTER TYPE "Role" ADD VALUE 'SALES'; END IF; END $$;`,
  `DO $$ BEGIN CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "SupplierCategory" AS ENUM ('COGS', 'SERVICES_EXPENSE', 'OPERATING_EXPENSE', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MANAGER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS "CustomerInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerInvoice_invoiceNumber_customerId_key" UNIQUE ("invoiceNumber", "customerId"),
    CONSTRAINT "CustomerInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS "CustomerInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS "SupplierInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "category" "SupplierCategory" NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierInvoice_invoiceNumber_supplierId_key" UNIQUE ("invoiceNumber", "supplierId"),
    CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS "SupplierInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" DECIMAL(15,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "customerInvoiceId" TEXT,
    "supplierInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_customerInvoiceId_fkey" FOREIGN KEY ("customerInvoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT UNIQUE,
    "phone" TEXT,
    "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "emergencyContactName" TEXT;`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "emergencyContactPhone" TEXT;`,
  `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTermsDays" INTEGER NOT NULL DEFAULT 30;`,
  `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "defaultCategory" "SupplierCategory";`,
  `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankName" TEXT;`,
  `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankAccountNumber" TEXT;`,
  `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankRouting" TEXT;`,
  `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "zelle" TEXT;`,
  `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentInstructions" TEXT;`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLogin" TIMESTAMP(3);`,
  `CREATE TABLE IF NOT EXISTS "CompanyProfile" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "name" TEXT,
    "logo" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "creditCardFeeRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "creditCardFeeLabel" TEXT NOT NULL DEFAULT 'Credit card processing fee',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `INSERT INTO "CompanyProfile" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "customerInvoicePrefix" TEXT NOT NULL DEFAULT 'INV-2026-';`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "customerInvoiceNextSeq" INTEGER NOT NULL DEFAULT 1001;`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "supplierInvoicePrefix" TEXT NOT NULL DEFAULT 'PO-2026-';`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "supplierInvoiceNextSeq" INTEGER NOT NULL DEFAULT 1001;`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "estimateNextSeq" INTEGER NOT NULL DEFAULT 1001;`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "customFees" JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  `ALTER TABLE "CustomerInvoice" ADD COLUMN IF NOT EXISTS "appliedFees" JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  `CREATE TABLE IF NOT EXISTS "TaxRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `ALTER TABLE "CustomerInvoice" ADD COLUMN IF NOT EXISTS "creditCardFee" DECIMAL(15,2) NOT NULL DEFAULT 0;`,
  `ALTER TABLE "CustomerInvoice" ADD COLUMN IF NOT EXISTS "downPayment" DECIMAL(15,2) NOT NULL DEFAULT 0;`,
  `ALTER TABLE "CustomerInvoice" ADD COLUMN IF NOT EXISTS "viewToken" TEXT;`,
  `ALTER TABLE "CustomerInvoice" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);`,
  `ALTER TABLE "CustomerInvoice" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;`,
  `ALTER TABLE "CustomerInvoice" ADD COLUMN IF NOT EXISTS "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CustomerInvoice_viewToken_key" ON "CustomerInvoice"("viewToken");`,
  `DO $$ BEGIN
    ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "incomeAccount" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS "UploadedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "customerInvoiceId" TEXT,
    "supplierInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_customerInvoiceId_fkey" FOREIGN KEY ("customerInvoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UploadedFile_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );`,
  `ALTER TABLE "SupplierInvoice" ADD COLUMN IF NOT EXISTS "customerInvoiceRef" TEXT;`,
  `ALTER TABLE "CustomerInvoiceItem" ADD COLUMN IF NOT EXISTS "itemDescription" TEXT;`,
  `ALTER TABLE "SupplierInvoiceItem" ADD COLUMN IF NOT EXISTS "itemDescription" TEXT;`,
  // Estimate/EstimateItem were fully implemented (prisma/schema.prisma,
  // /api/estimates/**, tests/estimates.test.ts) but never added here -- on
  // a fresh production database (this file is the only schema-provisioning
  // mechanism; see DEPLOYMENT.md) every /api/estimates call would fail with
  // "relation does not exist".
  `DO $$ BEGIN CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS "Estimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "estimateNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "estimateDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "subtotal" DECIMAL(15,2) NOT NULL,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "viewToken" TEXT,
    "sentAt" TIMESTAMP(3),
    "convertedInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Estimate_estimateNumber_customerId_key" UNIQUE ("estimateNumber", "customerId"),
    CONSTRAINT "Estimate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Estimate_viewToken_key" ON "Estimate"("viewToken");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Estimate_convertedInvoiceId_key" ON "Estimate"("convertedInvoiceId");`,
  `ALTER TABLE "Estimate" ADD COLUMN IF NOT EXISTS "appliedFees" JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  `CREATE TABLE IF NOT EXISTS "EstimateItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "estimateId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "itemDescription" TEXT,
    "quantity" DECIMAL(15,4) NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EstimateItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`,
  // Admin-only audit ledger (prisma/schema.prisma, lib/audit.ts,
  // /api/audit-log) -- same reasoning as Estimate/EstimateItem above: this
  // file is the only schema-provisioning mechanism, so a fresh production
  // database needs the table created here or every write to it 500s.
  `CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT NOT NULL,
    "changes" JSONB,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "AuditLog_timestamp_idx" ON "AuditLog" ("timestamp");`,
  `CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_idx" ON "AuditLog" ("actorUserId");`,
  `CREATE INDEX IF NOT EXISTS "AuditLog_entityType_idx" ON "AuditLog" ("entityType");`,
  `CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog" ("action");`,
  `CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL UNIQUE,
    "keyPrefix" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "scopes" JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  `CREATE INDEX IF NOT EXISTS "ApiKey_active_idx" ON "ApiKey" ("active");`,
];

export function initializeDatabase(): Promise<void> {
  if (!initPromise) initPromise = runInitialization();
  return initPromise;
}

async function runInitialization(): Promise<void> {
  console.log("[init-db] Creating tables if missing...");
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (e) {
      console.error("[init-db] statement failed:", e);
    }
  }
  console.log("[init-db] Schema ready");

  // Self-heal the document-numbering counters (see lib/next-number.ts) up
  // to at least "one past whatever's actually in the table" -- runs on
  // every boot, always via GREATEST so it only ever moves a counter
  // forward, never back. This exists for two reasons, not just belt-and-
  // suspenders:
  //   1. estimateNextSeq is a brand-new column; on an existing production
  //      database it starts at the schema default (1001) regardless of how
  //      many real estimates already exist, which would immediately cause
  //      collisions/reuse without this backfill.
  //   2. customerInvoiceNextSeq/supplierInvoiceNextSeq were previously
  //      advanced by a fire-and-forget update with a silently-swallowed
  //      error -- any historical failure there left the counter drifted
  //      below the true max, which this corrects.
  try {
    const numberingProfile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
    const customerPrefix = numberingProfile?.customerInvoicePrefix || "INV-2026-";
    const supplierPrefix = numberingProfile?.supplierInvoicePrefix || "PO-2026-";
    const estimatePrefix = `EST-${new Date().getFullYear()}-`;
    await backfillSequenceCounter("CustomerInvoice", "invoiceNumber", customerPrefix, "customerInvoiceNextSeq");
    await backfillSequenceCounter("SupplierInvoice", "invoiceNumber", supplierPrefix, "supplierInvoiceNextSeq");
    await backfillSequenceCounter("Estimate", "estimateNumber", estimatePrefix, "estimateNextSeq");
  } catch (e) {
    console.error("[init-db] sequence counter backfill failed:", e);
  }

  // The owner's one and only sign-in account is permanently pinned to ADMIN
  // here, regardless of what the Settings UI shows -- this is a deliberate,
  // owner-approved policy (confirmed 2026-08), not a bug. Do not remove.
  // admin@lacuevita.com was a leftover placeholder identity from this app's
  // initial build-out and is not used to sign in, so it is intentionally
  // not pinned here.
  const HARD_CODED_ADMINS = [
    "sales@lacuevitafurniture.com",
  ];
  for (const email of HARD_CODED_ADMINS) {
    try {
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "role" = 'ADMIN' WHERE LOWER("email") = LOWER($1) AND "role" <> 'ADMIN';`,
        email
      );
      if (updated > 0) {
        console.log(`[init-db] Force-promoted ${email} -> ADMIN (rows: ${updated})`);
      }
    } catch (e) {
      console.error(`[init-db] force-promote ${email} failed:`, e);
    }
  }

  try {
    // Self-heal: always make sure the owner's account is ADMIN.
    // (A one-time migration used to live here renaming an even older
    // admin@bizledger.com placeholder to admin@lacuevita.com -- both were
    // leftover identities from this app's initial build-out, are not used
    // to sign in, and that migration has long since completed, so it was
    // removed rather than kept running as dead weight on every boot.)
    const ownerAdmin = await prisma.user.findUnique({ where: { email: "sales@lacuevitafurniture.com" } });
    if (ownerAdmin && ownerAdmin.role !== "ADMIN") {
      await prisma.user.update({ where: { id: ownerAdmin.id }, data: { role: "ADMIN" } });
      console.log("[init-db] Restored sales@lacuevitafurniture.com role -> ADMIN");
    }

    const builtInAdmins = [
      "sales@lacuevitafurniture.com",
    ];
    const envAdmins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const adminEmails = Array.from(new Set([...builtInAdmins, ...envAdmins]));
    for (const email of adminEmails) {
      const u = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
      if (u && u.role !== "ADMIN") {
        await prisma.user.update({ where: { id: u.id }, data: { role: "ADMIN" } });
        console.log(`[init-db] Promoted ${u.email} -> ADMIN`);
      }
    }

    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount === 0) {
      // Emergency safety net only (every ADMIN account was deleted/demoted).
      // The password is random and never logged -- recovering access to
      // this account requires setting a new password directly against the
      // database, which is the correct floor for a last-resort recovery
      // path, not something visible in ordinary application logs.
      const randomPassword = randomBytes(24).toString("base64url");
      const hash = await bcrypt.hash(randomPassword, 12);
      await prisma.user.create({
        data: {
          email: "sales@lacuevitafurniture.com",
          name: "Owner",
          password: hash,
          role: "ADMIN",
        },
      });
      console.log(
        "[init-db] No ADMIN users existed -- created a fallback sales@lacuevitafurniture.com account with a random password. Set its password directly in the database to recover access."
      );
    }
  } catch (e) {
    console.error("[init-db] admin seed failed:", e);
  }
}

/**
 * Bumps `CompanyProfile[seqField]` up to at least "one past the highest
 * number this prefix's own series has ever used" in `table`, if it isn't
 * already there. Scoped to `prefix` (WHERE column LIKE prefix || '%', same
 * as the pre-counter MAX-scan this whole file replaced) -- an unscoped scan
 * would let an unrelated legacy/manually-typed number that merely happens
 * to contain a huge digit run (e.g. an old id like "99999999-legacy")
 * permanently inflate this prefix's counter to match it, on every single
 * boot. GREATEST means this only ever moves the counter forward, so it's
 * safe to run unconditionally every time.
 */
async function backfillSequenceCounter(
  table: string,
  column: string,
  prefix: string,
  seqField: SequenceField
): Promise<void> {
  const tableIdent = Prisma.raw(`"${table}"`);
  const columnIdent = Prisma.raw(`"${column}"`);
  const rows = await prisma.$queryRaw<{ maxSeq: number | null }[]>(Prisma.sql`
    SELECT MAX(CAST(substring(substring(${columnIdent} from length(${prefix}) + 1) from '^[0-9]+') AS INTEGER)) AS "maxSeq"
    FROM ${tableIdent}
    WHERE ${columnIdent} LIKE ${prefix + "%"}
  `);
  const maxSeq = rows[0]?.maxSeq ?? null;
  if (maxSeq === null) return;
  const seqColumnIdent = Prisma.raw(`"${seqField}"`);
  await prisma.$executeRaw`
    UPDATE "CompanyProfile" SET ${seqColumnIdent} = GREATEST(${seqColumnIdent}, ${maxSeq + 1}) WHERE "id" = 'default'
  `;
}
