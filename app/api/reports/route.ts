import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import Decimal from "decimal.js";

// Report types that are Admin-only (financial)
const ADMIN_ONLY_REPORTS = new Set(["profit-loss", "balance-sheet", "cash-flow"]);
// Report types available to Manager+
const MANAGER_REPORTS = new Set(["income", "expenses", "customer-outstanding", "supplier-outstanding"]);

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "profit-loss";

  if (ADMIN_ONLY_REPORTS.has(type)) {
    const { allowed } = requirePermission(session, "report_financial", "read");
    if (!allowed) {
      await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "report", entityLabel: `Report: ${type}`, ...extractMeta(request) });
      return NextResponse.json({ error: "Forbidden: financial reports are Admin-only" }, { status: 403 });
    }
  } else if (MANAGER_REPORTS.has(type)) {
    const { allowed } = requirePermission(session, "report_income_expense", "read");
    if (!allowed) {
      await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "report", entityLabel: `Report: ${type}`, ...extractMeta(request) });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const dateFilter = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
  const hasDate = from || to;

  if (type === "income") {
    const invoices = await prisma.customerInvoice.findMany({
      where: hasDate ? { invoiceDate: dateFilter } : {},
      include: { customer: true, items: true },
      orderBy: { invoiceDate: "desc" },
    });
    const total = invoices.reduce(
      (s, i) => s.plus(new Decimal(i.totalAmount.toString())),
      new Decimal(0)
    );
    return NextResponse.json({ invoices, total: total.toFixed(2) });
  }

  if (type === "expenses") {
    const invoices = await prisma.supplierInvoice.findMany({
      where: hasDate ? { invoiceDate: dateFilter } : {},
      include: { supplier: true, items: true },
      orderBy: { invoiceDate: "desc" },
    });
    const byCategory: Record<string, Decimal> = {};
    let total = new Decimal(0);
    invoices.forEach((inv) => {
      const amt = new Decimal(inv.totalAmount.toString());
      byCategory[inv.category] = (byCategory[inv.category] ?? new Decimal(0)).plus(amt);
      total = total.plus(amt);
    });
    return NextResponse.json({
      invoices,
      total: total.toFixed(2),
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, v.toFixed(2)])
      ),
    });
  }

  if (type === "profit-loss") {
    const [customerInvoices, supplierInvoices] = await Promise.all([
      prisma.customerInvoice.findMany({
        where: hasDate ? { invoiceDate: dateFilter } : {},
        select: { totalAmount: true, invoiceDate: true },
      }),
      prisma.supplierInvoice.findMany({
        where: hasDate ? { invoiceDate: dateFilter } : {},
        select: { totalAmount: true, category: true, invoiceDate: true },
      }),
    ]);

    const income = customerInvoices.reduce(
      (s, i) => s.plus(new Decimal(i.totalAmount.toString())),
      new Decimal(0)
    );
    const cogs = supplierInvoices
      .filter((i) => i.category === "COGS")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));
    const services = supplierInvoices
      .filter((i) => i.category === "SERVICES_EXPENSE")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));
    const operating = supplierInvoices
      .filter((i) => i.category === "OPERATING_EXPENSE")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));
    const other = supplierInvoices
      .filter((i) => i.category === "OTHER")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));

    const grossProfit = income.minus(cogs);
    const netProfit = grossProfit.minus(services).minus(operating);

    return NextResponse.json({
      income: income.toFixed(2),
      cogs: cogs.toFixed(2),
      services: services.toFixed(2),
      operating: operating.toFixed(2),
      other: other.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      netProfit: netProfit.toFixed(2),
      grossMargin: income.isZero() ? "0" : grossProfit.dividedBy(income).times(100).toFixed(2),
      netMargin: income.isZero() ? "0" : netProfit.dividedBy(income).times(100).toFixed(2),
    });
  }

  if (type === "customer-outstanding") {
    const invoices = await prisma.customerInvoice.findMany({
      where: { paymentStatus: { not: "PAID" } },
      include: { customer: true },
      orderBy: { dueDate: "asc" },
    });
    const total = invoices.reduce(
      (s, i) =>
        s.plus(
          new Decimal(i.totalAmount.toString()).minus(new Decimal(i.paidAmount.toString()))
        ),
      new Decimal(0)
    );
    return NextResponse.json({ invoices, total: total.toFixed(2) });
  }

  if (type === "supplier-outstanding") {
    const invoices = await prisma.supplierInvoice.findMany({
      where: { paymentStatus: { not: "PAID" } },
      include: { supplier: true },
      orderBy: { dueDate: "asc" },
    });
    const total = invoices.reduce(
      (s, i) =>
        s.plus(
          new Decimal(i.totalAmount.toString()).minus(new Decimal(i.paidAmount.toString()))
        ),
      new Decimal(0)
    );
    return NextResponse.json({ invoices, total: total.toFixed(2) });
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
}
