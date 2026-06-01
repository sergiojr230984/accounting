import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

let initialized = false;

const SCHEMA_STATEMENTS: string[] = [
  `DO $$ BEGIN CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
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

  // ── CRM: enums ──
  `DO $$ BEGIN CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'CLOSED', 'LOST'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "LeadSource" AS ENUM ('WHATSAPP', 'MANUAL', 'REFERRAL', 'FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "AssignmentMode" AS ENUM ('MANUAL', 'ROUND_ROBIN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  // Agrega el rol SALES (vendedora) al enum Role existente
  `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES';`,

  // ── CRM: columnas nuevas en User (vendedoras de WhatsApp) ──
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsappPhoneNumberId" TEXT;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_whatsappPhoneNumberId_key" ON "User"("whatsappPhoneNumberId");`,

  // ── CRM: tablas ──
  `CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "source" "LeadSource" NOT NULL DEFAULT 'WHATSAPP',
    "assignedToId" TEXT,
    "notes" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Lead_phone_key" ON "Lead"("phone");`,
  `CREATE INDEX IF NOT EXISTS "Lead_assignedToId_idx" ON "Lead"("assignedToId");`,
  `CREATE INDEX IF NOT EXISTS "Lead_status_idx" ON "Lead"("status");`,
  `CREATE INDEX IF NOT EXISTS "Lead_entryDate_idx" ON "Lead"("entryDate");`,
  `CREATE TABLE IF NOT EXISTS "LeadMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "waMessageId" TEXT,
    "fromNumber" TEXT,
    "toNumber" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LeadMessage_waMessageId_key" ON "LeadMessage"("waMessageId");`,
  `CREATE INDEX IF NOT EXISTS "LeadMessage_leadId_idx" ON "LeadMessage"("leadId");`,
  `CREATE TABLE IF NOT EXISTS "LeadAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "fromUserName" TEXT,
    "toUserId" TEXT NOT NULL,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadAssignment_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadAssignment_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS "LeadAssignment_leadId_idx" ON "LeadAssignment"("leadId");`,
  `CREATE TABLE IF NOT EXISTS "CrmSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'ROUND_ROBIN',
    "lastRotationIndex" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
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

  try {
    const legacyAdmin = await prisma.user.findUnique({ where: { email: "admin@bizledger.com" } });
    if (legacyAdmin) {
      await prisma.user.update({
        where: { id: legacyAdmin.id },
        data: { email: "admin@lacuevita.com" },
      });
      console.log("[init-db] Migrated admin email bizledger -> lacuevita");
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

  // Lead de prueba con el número real, para probar el CRM tras el deploy.
  // Idempotente: solo se crea si no existe ya.
  try {
    const testPhone = "+17863163774";
    const exists = await prisma.lead.findUnique({ where: { phone: testPhone } });
    if (!exists) {
      await prisma.lead.create({
        data: {
          name: "Número de prueba",
          phone: testPhone,
          status: "NEW",
          priority: "HIGH",
          source: "WHATSAPP",
          lastMessageText: "Hola, este es un mensaje de prueba 👋",
          lastMessageAt: new Date(),
          messages: {
            create: { direction: "INBOUND", body: "Hola, este es un mensaje de prueba 👋" },
          },
        },
      });
      console.log("[init-db] Lead de prueba creado:", testPhone);
    }
  } catch (e) {
    console.error("[init-db] test lead seed failed:", e);
  }
}
