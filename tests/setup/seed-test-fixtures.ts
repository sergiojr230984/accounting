import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Test-only fixtures for the P9dod branch. Unlike main, User has no relation
 * to Employee here — there is no per-salesperson row-level scoping concept
 * at all (confirmed by direct code review), so these are just two plain
 * SALES-role accounts used to test whether one can see/touch data created
 * under the other's session.
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
  await prisma.user.upsert({
    where: { email: "sales2@test.local" },
    update: {},
    create: { name: "Sales Rep Two", email: "sales2@test.local", password: pw, role: "SALES" },
  });

  console.log("[seed-test-fixtures] Ready: sales1@test.local, sales2@test.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
