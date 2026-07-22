import { PrismaClient, PaymentStatus, SupplierCategory } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

async function main() {
  // Users
  const adminPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@bizledger.com" },
    update: {},
    create: {
      name: "Admin User",
      email: "admin@bizledger.com",
      password: adminPassword,
      role: "ADMIN",
    },
  });

  const managerPassword = await bcrypt.hash("manager123", 12);
  await prisma.user.upsert({
    where: { email: "manager@bizledger.com" },
    update: {},
    create: {
      name: "Jane Manager",
      email: "manager@bizledger.com",
      password: managerPassword,
      role: "MANAGER",
    },
  });

  // Customers
  const acme = await prisma.customer.upsert({
    where: { id: "cust-acme" },
    update: {},
    create: {
      id: "cust-acme",
      name: "Acme Corp",
      email: "billing@acme.com",
      phone: "+1-555-0100",
      address: "123 Main St, Springfield, IL 62701",
    },
  });

  const globex = await prisma.customer.upsert({
    where: { id: "cust-globex" },
    update: {},
    create: {
      id: "cust-globex",
      name: "Globex Industries",
      email: "accounts@globex.com",
      phone: "+1-555-0200",
      address: "456 Oak Ave, Shelbyville, IL 62565",
    },
  });

  const initech = await prisma.customer.upsert({
    where: { id: "cust-initech" },
    update: {},
    create: {
      id: "cust-initech",
      name: "Initech LLC",
      email: "ap@initech.com",
      phone: "+1-555-0300",
      address: "789 Pine Rd, Capital City, IL 62701",
    },
  });

  // Suppliers
  const techSupply = await prisma.supplier.upsert({
    where: { id: "supp-tech" },
    update: {},
    create: {
      id: "supp-tech",
      name: "TechSupply Co",
      email: "invoices@techsupply.com",
      phone: "+1-555-0400",
      address: "100 Industrial Blvd, Chicago, IL 60601",
    },
  });

  const officeMax = await prisma.supplier.upsert({
    where: { id: "supp-office" },
    update: {},
    create: {
      id: "supp-office",
      name: "Office Essentials",
      email: "ar@officeessentials.com",
      phone: "+1-555-0500",
      address: "200 Commerce Dr, Naperville, IL 60540",
    },
  });

  const cloudServices = await prisma.supplier.upsert({
    where: { id: "supp-cloud" },
    update: {},
    create: {
      id: "supp-cloud",
      name: "CloudPro Services",
      email: "billing@cloudpro.io",
      phone: "+1-555-0600",
      address: "300 Tech Park, Schaumburg, IL 60173",
    },
  });

  // Customer Invoices
  const ci1 = await prisma.customerInvoice.upsert({
    where: { id: "ci-001" },
    update: {},
    create: {
      id: "ci-001",
      invoiceNumber: "INV-2024-001",
      customerId: acme.id,
      invoiceDate: new Date("2024-01-15"),
      dueDate: new Date("2024-02-15"),
      subtotal: new Decimal("5000.00"),
      taxAmount: new Decimal("400.00"),
      totalAmount: new Decimal("5400.00"),
      paidAmount: new Decimal("5400.00"),
      paymentStatus: PaymentStatus.PAID,
      notes: "January consulting services",
      items: {
        create: [
          {
            description: "Software Consulting",
            quantity: new Decimal("40"),
            unitPrice: new Decimal("125.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("5000.00"),
          },
        ],
      },
    },
  });

  const ci2 = await prisma.customerInvoice.upsert({
    where: { id: "ci-002" },
    update: {},
    create: {
      id: "ci-002",
      invoiceNumber: "INV-2024-002",
      customerId: globex.id,
      invoiceDate: new Date("2024-02-01"),
      dueDate: new Date("2024-03-01"),
      subtotal: new Decimal("8000.00"),
      taxAmount: new Decimal("640.00"),
      totalAmount: new Decimal("8640.00"),
      paidAmount: new Decimal("4000.00"),
      paymentStatus: PaymentStatus.PARTIALLY_PAID,
      notes: "Product delivery batch 1",
      items: {
        create: [
          {
            description: "Widget A",
            quantity: new Decimal("100"),
            unitPrice: new Decimal("50.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("5000.00"),
          },
          {
            description: "Widget B",
            quantity: new Decimal("60"),
            unitPrice: new Decimal("50.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("3000.00"),
          },
        ],
      },
    },
  });

  const ci3 = await prisma.customerInvoice.upsert({
    where: { id: "ci-003" },
    update: {},
    create: {
      id: "ci-003",
      invoiceNumber: "INV-2024-003",
      customerId: initech.id,
      invoiceDate: new Date("2024-03-10"),
      dueDate: new Date("2024-04-10"),
      subtotal: new Decimal("3200.00"),
      taxAmount: new Decimal("256.00"),
      totalAmount: new Decimal("3456.00"),
      paidAmount: new Decimal("0.00"),
      paymentStatus: PaymentStatus.UNPAID,
      notes: "March maintenance contract",
      items: {
        create: [
          {
            description: "System Maintenance",
            quantity: new Decimal("1"),
            unitPrice: new Decimal("3200.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("3200.00"),
          },
        ],
      },
    },
  });

  const ci4 = await prisma.customerInvoice.upsert({
    where: { id: "ci-004" },
    update: {},
    create: {
      id: "ci-004",
      invoiceNumber: "INV-2024-004",
      customerId: acme.id,
      invoiceDate: new Date("2024-04-01"),
      dueDate: new Date("2024-05-01"),
      subtotal: new Decimal("12000.00"),
      taxAmount: new Decimal("960.00"),
      totalAmount: new Decimal("12960.00"),
      paidAmount: new Decimal("12960.00"),
      paymentStatus: PaymentStatus.PAID,
      notes: "Q1 product order",
      items: {
        create: [
          {
            description: "Enterprise License",
            quantity: new Decimal("4"),
            unitPrice: new Decimal("3000.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("12000.00"),
          },
        ],
      },
    },
  });

  // Supplier Invoices
  await prisma.supplierInvoice.upsert({
    where: { id: "si-001" },
    update: {},
    create: {
      id: "si-001",
      invoiceNumber: "TS-2024-0101",
      supplierId: techSupply.id,
      invoiceDate: new Date("2024-01-05"),
      dueDate: new Date("2024-02-05"),
      category: SupplierCategory.COGS,
      subtotal: new Decimal("2000.00"),
      taxAmount: new Decimal("160.00"),
      totalAmount: new Decimal("2160.00"),
      paidAmount: new Decimal("2160.00"),
      paymentStatus: PaymentStatus.PAID,
      notes: "Raw materials for Q1",
      items: {
        create: [
          {
            description: "Component A (bulk)",
            quantity: new Decimal("200"),
            unitCost: new Decimal("10.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("2000.00"),
          },
        ],
      },
    },
  });

  await prisma.supplierInvoice.upsert({
    where: { id: "si-002" },
    update: {},
    create: {
      id: "si-002",
      invoiceNumber: "OE-2024-0201",
      supplierId: officeMax.id,
      invoiceDate: new Date("2024-01-15"),
      dueDate: new Date("2024-02-15"),
      category: SupplierCategory.OPERATING_EXPENSE,
      subtotal: new Decimal("450.00"),
      taxAmount: new Decimal("36.00"),
      totalAmount: new Decimal("486.00"),
      paidAmount: new Decimal("486.00"),
      paymentStatus: PaymentStatus.PAID,
      notes: "Office supplies January",
      items: {
        create: [
          {
            description: "Office Supplies Pack",
            quantity: new Decimal("1"),
            unitCost: new Decimal("450.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("450.00"),
          },
        ],
      },
    },
  });

  await prisma.supplierInvoice.upsert({
    where: { id: "si-003" },
    update: {},
    create: {
      id: "si-003",
      invoiceNumber: "CP-2024-0301",
      supplierId: cloudServices.id,
      invoiceDate: new Date("2024-02-01"),
      dueDate: new Date("2024-03-01"),
      category: SupplierCategory.SERVICES_EXPENSE,
      subtotal: new Decimal("800.00"),
      taxAmount: new Decimal("0.00"),
      totalAmount: new Decimal("800.00"),
      paidAmount: new Decimal("800.00"),
      paymentStatus: PaymentStatus.PAID,
      notes: "Cloud hosting February",
      items: {
        create: [
          {
            description: "Cloud Hosting Monthly",
            quantity: new Decimal("1"),
            unitCost: new Decimal("800.00"),
            taxRate: new Decimal("0"),
            lineTotal: new Decimal("800.00"),
          },
        ],
      },
    },
  });

  await prisma.supplierInvoice.upsert({
    where: { id: "si-004" },
    update: {},
    create: {
      id: "si-004",
      invoiceNumber: "TS-2024-0402",
      supplierId: techSupply.id,
      invoiceDate: new Date("2024-03-15"),
      dueDate: new Date("2024-04-15"),
      category: SupplierCategory.COGS,
      subtotal: new Decimal("3500.00"),
      taxAmount: new Decimal("280.00"),
      totalAmount: new Decimal("3780.00"),
      paidAmount: new Decimal("0.00"),
      paymentStatus: PaymentStatus.UNPAID,
      notes: "Raw materials Q2",
      items: {
        create: [
          {
            description: "Component B",
            quantity: new Decimal("350"),
            unitCost: new Decimal("10.00"),
            taxRate: new Decimal("0.08"),
            lineTotal: new Decimal("3500.00"),
          },
        ],
      },
    },
  });

  // Payments
  await prisma.payment.createMany({
    skipDuplicates: true,
    data: [
      {
        amount: new Decimal("5400.00"),
        paymentDate: new Date("2024-02-10"),
        notes: "Wire transfer",
        customerInvoiceId: ci1.id,
      },
      {
        amount: new Decimal("4000.00"),
        paymentDate: new Date("2024-02-28"),
        notes: "Partial payment",
        customerInvoiceId: ci2.id,
      },
      {
        amount: new Decimal("12960.00"),
        paymentDate: new Date("2024-04-25"),
        notes: "Full payment received",
        customerInvoiceId: ci4.id,
      },
    ],
  });

  console.log("✅ Seed complete");
  console.log("  Admin: admin@bizledger.com / admin123");
  console.log("  Manager: manager@bizledger.com / manager123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
