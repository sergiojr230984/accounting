import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireReadAccessRole } from "@/lib/api";
import Decimal from "decimal.js";

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function pctChange(curr: Decimal, prev: Decimal): number | null {
  // No prior-period activity to compare against -- showing "+100%" (or any
  // percentage) against a zero baseline is misleading, so the client hides
  // the delta entirely in that case, same as flat zero-vs-zero.
  if (prev.isZero()) return curr.isZero() ? 0 : null;
  return curr.minus(prev).dividedBy(prev).times(100).toNumber();
}

export async function GET(request: Request) {
  // Same audience as the main dashboard endpoint -- this is just a
  // different slice (today, by hour) of the same company-wide sales data.
  const guard = await requireReadAccessRole(request, "dashboard", "ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Same weekday, one week back -- e.g. viewing on a Saturday compares
  // against last Saturday, so the comparison isn't skewed by weekday
  // traffic patterns (weekends vs. weekdays).
  const comparisonStart = new Date(todayStart);
  comparisonStart.setDate(comparisonStart.getDate() - 7);
  const comparisonEnd = new Date(comparisonStart);
  comparisonEnd.setDate(comparisonEnd.getDate() + 1);

  // Bucketed by `createdAt` (when the invoice was actually entered), not
  // `invoiceDate` -- the invoice date is a plain date the user picks with no
  // time-of-day component, so every invoice for a day would collapse onto a
  // single hour. `createdAt` is the closest signal this system has to "when
  // did this sale actually happen."
  const invoices = await prisma.customerInvoice.findMany({
    where: {
      OR: [
        { createdAt: { gte: todayStart, lt: todayEnd } },
        { createdAt: { gte: comparisonStart, lt: comparisonEnd } },
      ],
    },
    select: { totalAmount: true, createdAt: true },
  });

  const todayHours = Array.from({ length: 24 }, () => new Decimal(0));
  const comparisonHours = Array.from({ length: 24 }, () => new Decimal(0));
  let todayCount = 0;
  let comparisonCount = 0;

  for (const inv of invoices) {
    const amount = new Decimal(inv.totalAmount.toString());
    const created = new Date(inv.createdAt);
    if (created >= todayStart && created < todayEnd) {
      todayHours[created.getHours()] = todayHours[created.getHours()].plus(amount);
      todayCount++;
    } else {
      comparisonHours[created.getHours()] = comparisonHours[created.getHours()].plus(amount);
      comparisonCount++;
    }
  }

  const netSales = todayHours.reduce((sum, v) => sum.plus(v), new Decimal(0));
  const comparisonNetSales = comparisonHours.reduce((sum, v) => sum.plus(v), new Decimal(0));

  const avgInvoice = todayCount > 0 ? netSales.dividedBy(todayCount) : new Decimal(0);
  const comparisonAvgInvoice =
    comparisonCount > 0 ? comparisonNetSales.dividedBy(comparisonCount) : new Decimal(0);

  return NextResponse.json({
    netSales: netSales.toFixed(2),
    netSalesChangePct: pctChange(netSales, comparisonNetSales),
    invoiceCount: todayCount,
    invoiceCountChangePct: pctChange(new Decimal(todayCount), new Decimal(comparisonCount)),
    avgInvoice: avgInvoice.toFixed(2),
    avgInvoiceChangePct: pctChange(avgInvoice, comparisonAvgInvoice),
    comparisonLabel: comparisonStart.toLocaleDateString("en-US", { weekday: "long" }),
    currentHour: now.getHours(),
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      today: todayHours[hour].toNumber(),
      comparison: comparisonHours[hour].toNumber(),
    })),
  });
}
