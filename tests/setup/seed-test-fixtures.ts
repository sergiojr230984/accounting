import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Test-only fixtures for the P9dod branch. User has no direct relation to
 * Employee here, but both models have a unique `email` field -- horizontal
 * SALES scoping matches on that (see lib/api.ts's scopeInvoicesToOwnEmployee),
 * so each SALES test account gets a same-email Employee row to link to.
 */

const prisma = new PrismaClient();

export const TEST_SALES_PASSWORD = "salesTest#1pw";

async function main() {
  const pw = await bcrypt.hash(TEST_SALES_PASSWORD, 12);

  await prisma.user.upsert({
    where: { email: "sales1@test.local" },
    update: {},
    create: { name: "Sales Rep One", email: "sales1@test.local", password: pw, role: "SALES" },
  });
  await prisma.employee.upsert({
    where: { email: "sales1@test.local" },
    update: {},
    create: { name: "Sales Rep One", email: "sales1@test.local" },
  });
  await prisma.user.upsert({
    where: { email: "sales2@test.local" },
    update: {},
    create: { name: "Sales Rep Two", email: "sales2@test.local", password: pw, role: "SALES" },
  });
  await prisma.employee.upsert({
    where: { email: "sales2@test.local" },
    update: {},
    create: { name: "Sales Rep Two", email: "sales2@test.local" },
  });

  console.log("[seed-test-fixtures] Ready: sales1@test.local, sales2@test.local (each with a linked Employee record)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
