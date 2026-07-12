import { PrismaClient, PaymentStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Test-only fixtures used by the integration suite: two SALES-role users,
 * each linked to their own Employee record and their own customer invoice,
 * so horizontal-access tests have real, isolated data to probe. Never run
 * against a non-disposable database.
 */

const prisma = new PrismaClient();

export const TEST_SALES_PASSWORD = "salesTest#1pw";

async function main() {
  const pw = await bcrypt.hash(TEST_SALES_PASSWORD, 12);

  const emp1 = await prisma.employee.upsert({
    where: { email: "sales1@test.local" },
    update: {},
    create: { name: "Sales Rep One", email: "sales1@test.local", commissionRate: new Decimal("0.05") },
  });
  const emp2 = await prisma.employee.upsert({
    where: { email: "sales2@test.local" },
    update: {},
    create: { name: "Sales Rep Two", email: "sales2@test.local", commissionRate: new Decimal("0.07") },
  });

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

  const cust = await prisma.customer.upsert({
    where: { id: "cust-fixture-test" },
    update: {},
    create: { id: "cust-fixture-test", name: "Fixture Test Customer", email: "fixture@test.local" },
  });

  await prisma.customerInvoice.upsert({
    where: { id: "inv-fixture-sales1" },
    update: {},
    create: {
      id: "inv-fixture-sales1",
      invoiceNumber: "FIXTURE-S1-001",
      customerId: cust.id,
      invoiceDate: new Date("2026-01-01"),
      dueDate: new Date("2026-01-31"),
      subtotal: new Decimal("500.00"),
      totalAmount: new Decimal("500.00"),
      paymentStatus: PaymentStatus.UNPAID,
      employeeId: emp1.id,
      commissionRate: new Decimal("0.05"),
    },
  });

  await prisma.customerInvoice.upsert({
    where: { id: "inv-fixture-sales2" },
    update: {},
    create: {
      id: "inv-fixture-sales2",
      invoiceNumber: "FIXTURE-S2-001",
      customerId: cust.id,
      invoiceDate: new Date("2026-01-01"),
      dueDate: new Date("2026-01-31"),
      subtotal: new Decimal("750.00"),
      totalAmount: new Decimal("750.00"),
      paymentStatus: PaymentStatus.UNPAID,
      employeeId: emp2.id,
      commissionRate: new Decimal("0.07"),
    },
  });

  console.log("[seed-test-fixtures] Ready: sales1@test.local, sales2@test.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
