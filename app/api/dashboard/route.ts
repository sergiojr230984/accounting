import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Decimal from "decimal.js";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const dateFilter = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };

  const hasDateFilter = from || to;

  const [customerInvoices, supplierInvoices] = await Promise.all([
    prisma.customerInvoice.findMany({
      where: hasDateFilter ? { invoiceDate: dateFilter } : {},
      select: {
        totalAmount: true,
        paidAmount: true,
        paymentStatus: true,
        invoiceDate: true,
      },
    }),
    prisma.supplierInvoice.findMany({
      where: hasDateFilter ? { invoiceDate: dateFilter } : {},
      select: {
        totalAmount: true,
        paidAmount: true,
        paymentStatus: true,
        category: true,
        invoiceDate: true,
      },
    }),
  ]);

  const zero = new Decimal(0);

  const totalIncome = customerInvoices.reduce(
    (sum, inv) => sum.plus(new Decimal(inv.totalAmount.toString())),
    zero
  );
  const totalCOGS = supplierInvoices
    .filter((i) => i.category === "COGS")
    .reduce((sum, inv) => sum.plus(new Decimal(inv.totalAmount.toString())), zero);
  const totalServices = supplierInvoices
    .filter((i) => i.category === "SERVICES_EXPENSE")
    .reduce((sum, inv) => sum.plus(new Decimal(inv.totalAmount.toString())), zero);
  const totalOperating = supplierInvoices
    .filter((i) => i.category === "OPERATING_EXPENSE")
    .reduce((sum, inv) => sum.plus(new Decimal(inv.totalAmount.toString())), zero);
  const totalOther = supplierInvoices
    .filter((i) => i.category === "OTHER")
    .reduce((sum, inv) => sum.plus(new Decimal(inv.totalAmount.toString())), zero);

  const grossProfit = totalIncome.minus(totalCOGS);
  const netProfit = grossProfit.minus(totalServices).minus(totalOperating);

  const unpaidCustomer = customerInvoices.filter((i) => i.paymentStatus !== "PAID");
  const unpaidSupplier = supplierInvoices.filter((i) => i.paymentStatus !== "PAID");

  const unpaidCustomerTotal = unpaidCustomer.reduce(
    (sum, inv) =>
      sum.plus(
        new Decimal(inv.totalAmount.toString()).minus(new Decimal(inv.paidAmount.toString()))
      ),
    zero
  );
  const unpaidSupplierTotal = unpaidSupplier.reduce(
    (sum, inv) =>
      sum.plus(
        new Decimal(inv.totalAmount.toString()).minus(new Decimal(inv.paidAmount.toString()))
      ),
    zero
  );

  // Monthly chart data (last 12 months)
  type MonthBucket = {
    income: Decimal;
    cogs: Decimal;
    services: Decimal;
    operating: Decimal;
    other: Decimal;
  };
  const monthlyMap = new Map<string, MonthBucket>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, {
      income: new Decimal(0),
      cogs: new Decimal(0),
      services: new Decimal(0),
      operating: new Decimal(0),
      other: new Decimal(0),
    });
  }

  customerInvoices.forEach((inv) => {
    const d = new Date(inv.invoiceDate);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap.has(key)) {
      monthlyMap.get(key)!.income = monthlyMap
        .get(key)!
        .income.plus(new Decimal(inv.totalAmount.toString()));
    }
  });

  const categoryField: Record<string, keyof MonthBucket> = {
    COGS: "cogs",
    SERVICES_EXPENSE: "services",
    OPERATING_EXPENSE: "operating",
    OTHER: "other",
  };

  supplierInvoices.forEach((inv) => {
    const d = new Date(inv.invoiceDate);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = monthlyMap.get(key);
    const field = categoryField[inv.category];
    if (bucket && field) {
      bucket[field] = bucket[field].plus(new Decimal(inv.totalAmount.toString()));
    }
  });

  const monthlyChart = Array.from(monthlyMap.entries()).map(([month, data]) => {
    const expenses = data.cogs.plus(data.services).plus(data.operating).plus(data.other);
    return {
      month,
      income: data.income.toNumber(),
      expenses: expenses.toNumber(),
      cogs: data.cogs.toNumber(),
      services: data.services.toNumber(),
      operating: data.operating.toNumber(),
      other: data.other.toNumber(),
      profit: data.income.minus(expenses).toNumber(),
    };
  });

  return NextResponse.json({
    totalIncome: totalIncome.toFixed(2),
    totalCOGS: totalCOGS.toFixed(2),
    totalServices: totalServices.toFixed(2),
    totalOperating: totalOperating.toFixed(2),
    totalOther: totalOther.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    netProfit: netProfit.toFixed(2),
    unpaidCustomerCount: unpaidCustomer.length,
    unpaidCustomerTotal: unpaidCustomerTotal.toFixed(2),
    unpaidSupplierCount: unpaidSupplier.length,
    unpaidSupplierTotal: unpaidSupplierTotal.toFixed(2),
    totalSupplierExpenses: totalCOGS.plus(totalServices).plus(totalOperating).plus(totalOther).toFixed(2),
    monthlyChart,
  });
}
