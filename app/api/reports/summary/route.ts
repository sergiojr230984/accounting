import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireReadAccess } from "@/lib/api";
import Decimal from "decimal.js";

// A deliberately narrow, aggregate-only view for the "summary" API-key
// scope: total sales/bills and invoice/bill counts bucketed by day, week,
// or month. No customer/supplier names, no line items, no ids beyond what's
// needed to count -- built for a dashboard that only wants trend numbers,
// not the full record list (that's what the "invoices:customer" /
// "invoices:supplier" scopes and their list endpoints are for).

type GroupBy = "day" | "week" | "month";

// invoiceDate is stored as a UTC-midnight Date (see lib/date.ts's
// formatDateOnly doc comment) -- bucketing off UTC components keeps this
// consistent with how every other date in the app is read, rather than
// letting the server's local timezone shift a date into the wrong bucket.
function bucketKey(date: Date, groupBy: GroupBy): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (groupBy === "month") {
    return `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  if (groupBy === "week") {
    const utcDate = new Date(Date.UTC(y, m, d));
    const day = utcDate.getUTCDay(); // 0 = Sunday
    const diffToMonday = (day + 6) % 7;
    utcDate.setUTCDate(utcDate.getUTCDate() - diffToMonday);
    return utcDate.toISOString().slice(0, 10);
  }
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const access = await requireReadAccess(request, "summary");
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  if (type !== "sales" && type !== "bills") {
    return NextResponse.json(
      { error: "type must be \"sales\" or \"bills\"" },
      { status: 400 }
    );
  }
  const groupByParam = searchParams.get("groupBy") ?? "month";
  if (groupByParam !== "day" && groupByParam !== "week" && groupByParam !== "month") {
    return NextResponse.json(
      { error: "groupBy must be \"day\", \"week\", or \"month\"" },
      { status: 400 }
    );
  }
  const groupBy: GroupBy = groupByParam;

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const dateFilter = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
  const where = from || to ? { invoiceDate: dateFilter } : {};

  const rows =
    type === "sales"
      ? await prisma.customerInvoice.findMany({
          where,
          select: { invoiceDate: true, totalAmount: true },
        })
      : await prisma.supplierInvoice.findMany({
          where,
          select: { invoiceDate: true, totalAmount: true },
        });

  const buckets = new Map<string, { total: Decimal; count: number }>();
  for (const row of rows) {
    const key = bucketKey(row.invoiceDate, groupBy);
    const amount = new Decimal(row.totalAmount.toString());
    const existing = buckets.get(key);
    if (existing) {
      existing.total = existing.total.plus(amount);
      existing.count += 1;
    } else {
      buckets.set(key, { total: amount, count: 1 });
    }
  }

  const periods = Array.from(buckets.entries())
    .map(([period, { total, count }]) => ({ period, total: total.toFixed(2), count }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const grandTotal = periods.reduce((s, p) => s.plus(p.total), new Decimal(0));

  return NextResponse.json({
    type,
    groupBy,
    periods,
    grandTotal: grandTotal.toFixed(2),
    grandCount: rows.length,
  });
}
