import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireReadAccessRole } from "@/lib/api";
import Decimal from "decimal.js";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Server processes (Railway, etc.) run in UTC, but "today" and "this hour"
// need to mean the business's own wall-clock day/hour, not the server's --
// otherwise afternoon/evening sales (which are still "today" locally) land
// on the server's next UTC calendar day and silently vanish from the chart.
// The browser tells us its IANA zone (?tz=), and everything below reads
// each timestamp's local date/hour via Intl rather than the server's own
// Date getters.
function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localHour(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  // Some locales/engines render midnight as "24" with hour12: false.
  return Number(parts.find((p) => p.type === "hour")!.value) % 24;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
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

  const { searchParams } = new URL(request.url);
  const tzParam = searchParams.get("tz");
  const timeZone = tzParam && isValidTimeZone(tzParam) ? tzParam : "UTC";

  const now = new Date();
  const todayKey = localDateKey(now, timeZone);

  // Same weekday, one week back -- e.g. viewing on a Saturday compares
  // against last Saturday, so the comparison isn't skewed by weekday
  // traffic patterns (weekends vs. weekdays). Calendar arithmetic on the
  // Y/M/D key (not a raw 7*24h instant subtraction) so a DST transition
  // can't nudge the result onto the wrong calendar day.
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const comparisonAnchor = new Date(Date.UTC(ty, tm - 1, td - 7));
  const comparisonKey = `${comparisonAnchor.getUTCFullYear()}-${String(comparisonAnchor.getUTCMonth() + 1).padStart(2, "0")}-${String(comparisonAnchor.getUTCDate()).padStart(2, "0")}`;
  const comparisonWeekday = WEEKDAY_NAMES[comparisonAnchor.getUTCDay()];

  // A generously padded fetch window in real (server-clock) time -- the
  // precise bucketing below is what actually decides "today" vs. "that day
  // last week" vs. neither, via each timestamp's local date key, so this
  // just needs to comfortably cover both local days regardless of the
  // server/business timezone offset.
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 9);

  const invoices = await prisma.customerInvoice.findMany({
    where: { createdAt: { gte: windowStart, lte: now } },
    select: { totalAmount: true, createdAt: true },
  });

  const todayHours = Array.from({ length: 24 }, () => new Decimal(0));
  const comparisonHours = Array.from({ length: 24 }, () => new Decimal(0));
  let todayCount = 0;
  let comparisonCount = 0;

  for (const inv of invoices) {
    const created = new Date(inv.createdAt);
    const key = localDateKey(created, timeZone);
    if (key !== todayKey && key !== comparisonKey) continue;

    const amount = new Decimal(inv.totalAmount.toString());
    const hour = localHour(created, timeZone);
    if (key === todayKey) {
      todayHours[hour] = todayHours[hour].plus(amount);
      todayCount++;
    } else {
      comparisonHours[hour] = comparisonHours[hour].plus(amount);
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
    comparisonLabel: comparisonWeekday,
    currentHour: localHour(now, timeZone),
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      today: todayHours[hour].toNumber(),
      comparison: comparisonHours[hour].toNumber(),
    })),
  });
}
