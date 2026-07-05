import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

let initialized = false;

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
  `INSERT INTO "CompanyProfile" ("id", "createdAt", "updatedAt") VALUES ('default', NOW(), NOW()) ON CONFLICT DO NOTHING;`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "customerInvoicePrefix" TEXT NOT NULL DEFAULT 'INV-2026-';`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "customerInvoiceNextSeq" INTEGER NOT NULL DEFAULT 1001;`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "supplierInvoicePrefix" TEXT NOT NULL DEFAULT 'PO-2026-';`,
  `ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "supplierInvoiceNextSeq" INTEGER NOT NULL DEFAULT 1001;`,
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
];

export async function initializeDatabase() {
  if (initialized) return;
  initialized = true;

  console.log("[init-db] Creating tables if missing...");
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (e) {
      console.error("[init-db] statement failed:", e);
    }
  }
  console.log("[init-db] Schema ready");

  // Fix any invoices where paymentStatus doesn't match the actual paid/down amounts
  try {
    const fixed = await prisma.$executeRawUnsafe(`
      UPDATE "CustomerInvoice"
      SET "paymentStatus" = CASE
        WHEN "totalAmount" - "paidAmount" - "downPayment" <= 0 THEN 'PAID'::"PaymentStatus"
        WHEN "paidAmount" > 0 OR "downPayment" > 0             THEN 'PARTIALLY_PAID'::"PaymentStatus"
        ELSE 'UNPAID'::"PaymentStatus"
      END
      WHERE "paymentStatus" IS DISTINCT FROM CASE
        WHEN "totalAmount" - "paidAmount" - "downPayment" <= 0 THEN 'PAID'::"PaymentStatus"
        WHEN "paidAmount" > 0 OR "downPayment" > 0             THEN 'PARTIALLY_PAID'::"PaymentStatus"
        ELSE 'UNPAID'::"PaymentStatus"
      END
    `);
    if (fixed > 0) {
      console.log(`[init-db] Corrected paymentStatus on ${fixed} invoice(s)`);
    }
  } catch (e) {
    console.error("[init-db] paymentStatus backfill failed:", e);
  }

  const HARD_CODED_ADMINS = [
    "admin@lacuevita.com",
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
    const legacyAdmin = await prisma.user.findUnique({ where: { email: "admin@bizledger.com" } });
    if (legacyAdmin) {
      await prisma.user.update({
        where: { id: legacyAdmin.id },
        data: { email: "admin@lacuevita.com", role: "ADMIN" },
      });
      console.log("[init-db] Migrated admin email bizledger -> lacuevita (role=ADMIN)");
    }

    const lcAdmin = await prisma.user.findUnique({ where: { email: "admin@lacuevita.com" } });
    if (lcAdmin && lcAdmin.role !== "ADMIN") {
      await prisma.user.update({ where: { id: lcAdmin.id }, data: { role: "ADMIN" } });
      console.log("[init-db] Restored admin@lacuevita.com role -> ADMIN");
    }

    const builtInAdmins = [
      "admin@lacuevita.com",
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
      const hash = await bcrypt.hash("admin123", 12);
      await prisma.user.create({
        data: {
          email: "admin@lacuevita.com",
          name: "Admin",
          password: hash,
          role: "ADMIN",
        },
      });
      console.log("[init-db] Default admin seeded: admin@lacuevita.com / admin123");
    }
  } catch (e) {
    console.error("[init-db] admin seed failed:", e);
  }
}
