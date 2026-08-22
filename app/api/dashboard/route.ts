import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireReadAccessRole } from "@/lib/api";
import Decimal from "decimal.js";

export async function GET(request: Request) {
  // Company-wide P&L, COGS, and unpaid totals -- not something every
  // authenticated role should see, including SALES. An API key (always
  // admin-provisioned) also satisfies this, for external dashboards.
  const guard = await requireReadAccessRole(request, "dashboard", "ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const granularityParam = searchParams.get("granularity");
  const granularity: "daily" | "weekly" | "monthly" =
    granularityParam === "daily" || granularityParam === "weekly" ? granularityParam : "monthly";

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

  // Chart data, bucketed at the requested granularity: daily (last 30 days),
  // weekly (last 12 weeks, bucketed to each week's Monday), or monthly
  // (last 12 months -- the original/default behavior).
  type Bucket = {
    income: Decimal;
    cogs: Decimal;
    services: Decimal;
    operating: Decimal;
    other: Decimal;
  };

  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const weekStart = (d: Date) => {
    const monday = new Date(d);
    const day = monday.getDay(); // 0 (Sun) - 6 (Sat)
    monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const periods: string[] = [];
  let bucketKeyFor: (d: Date) => string;

  if (granularity === "daily") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      periods.push(dateKey(d));
    }
    bucketKeyFor = dateKey;
  } else if (granularity === "weekly") {
    const thisWeekStart = weekStart(new Date());
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisWeekStart);
      d.setDate(d.getDate() - i * 7);
      periods.push(dateKey(d));
    }
    bucketKeyFor = (d) => dateKey(weekStart(d));
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      periods.push(monthKey(d));
    }
    bucketKeyFor = monthKey;
  }

  const bucketMap = new Map<string, Bucket>();
  for (const p of periods) {
    bucketMap.set(p, {
      income: new Decimal(0),
      cogs: new Decimal(0),
      services: new Decimal(0),
      operating: new Decimal(0),
      other: new Decimal(0),
    });
  }

  customerInvoices.forEach((inv) => {
    const bucket = bucketMap.get(bucketKeyFor(new Date(inv.invoiceDate)));
    if (bucket) {
      bucket.income = bucket.income.plus(new Decimal(inv.totalAmount.toString()));
    }
  });

  const categoryField: Record<string, keyof Bucket> = {
    COGS: "cogs",
    SERVICES_EXPENSE: "services",
    OPERATING_EXPENSE: "operating",
    OTHER: "other",
  };

  supplierInvoices.forEach((inv) => {
    const bucket = bucketMap.get(bucketKeyFor(new Date(inv.invoiceDate)));
    const field = categoryField[inv.category];
    if (bucket && field) {
      bucket[field] = bucket[field].plus(new Decimal(inv.totalAmount.toString()));
    }
  });

  const chart = periods.map((period) => {
    const data = bucketMap.get(period)!;
    const expenses = data.cogs.plus(data.services).plus(data.operating).plus(data.other);
    return {
      period,
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
    chart,
    granularity,
  });
}
