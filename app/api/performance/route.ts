import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireRole } from "@/lib/api";
import Decimal from "decimal.js";

export async function GET(request: Request) {
  // Company-wide commission/sales leaderboard across every salesperson --
  // not something any one salesperson should see about their peers.
  const guard = await requireRole("ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;

  await initializeDatabase();

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = { employeeId: { not: null } };
  if (from || to) {
    where.invoiceDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });

  const invoices = await prisma.customerInvoice.findMany({
    where,
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      totalAmount: true,
      paidAmount: true,
      paymentStatus: true,
      employeeId: true,
      commissionRate: true,
      customer: { select: { name: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });

  const byEmployee = new Map<
    string,
    { employeeId: string; employeeName: string; invoiceCount: number; salesTotal: Decimal; commissionTotal: Decimal; paidCount: number }
  >();
  for (const emp of employees) {
    byEmployee.set(emp.id, {
      employeeId: emp.id,
      employeeName: emp.name,
      invoiceCount: 0,
      salesTotal: new Decimal(0),
      commissionTotal: new Decimal(0),
      paidCount: 0,
    });
  }
  for (const inv of invoices) {
    if (!inv.employeeId) continue;
    const stats = byEmployee.get(inv.employeeId);
    if (!stats) continue;
    stats.invoiceCount += 1;
    const total = new Decimal(inv.totalAmount.toString());
    stats.salesTotal = stats.salesTotal.plus(total);
    stats.commissionTotal = stats.commissionTotal.plus(total.times(inv.commissionRate.toString()));
    if (inv.paymentStatus === "PAID") stats.paidCount += 1;
  }

  const leaderboard = Array.from(byEmployee.values())
    .map((e) => ({
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      invoiceCount: e.invoiceCount,
      salesTotal: e.salesTotal.toFixed(2),
      commissionTotal: e.commissionTotal.toFixed(2),
      paidCount: e.paidCount,
      paidRate: e.invoiceCount > 0 ? e.paidCount / e.invoiceCount : 0,
    }))
    .sort((a, b) => parseFloat(b.salesTotal) - parseFloat(a.salesTotal));

  return NextResponse.json({
    leaderboard,
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      customerName: i.customer.name,
      totalAmount: i.totalAmount.toString(),
      paidAmount: i.paidAmount.toString(),
      paymentStatus: i.paymentStatus,
      employeeId: i.employeeId,
      commissionRate: i.commissionRate.toString(),
      commissionAmount: new Decimal(i.totalAmount.toString()).times(i.commissionRate.toString()).toFixed(2),
    })),
  });
}
