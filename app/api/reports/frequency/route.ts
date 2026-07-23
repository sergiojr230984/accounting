import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import Decimal from "decimal.js";

export const dynamic = "force-dynamic";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function monthsInRange(from: string | null, to: string | null): string[] {
  if (!from && !to) return [];
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date();
  const months: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= endMonth) {
    months.push(cur.toISOString().slice(0, 7));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

export async function GET(request: Request) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) {
    const d = new Date(to);
    d.setHours(23, 59, 59, 999);
    dateFilter.lte = d;
  }

  const items = await prisma.customerInvoiceItem.findMany({
    where: {
      invoice: Object.keys(dateFilter).length > 0 ? { invoiceDate: dateFilter } : undefined,
    },
    select: {
      description: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      invoice: {
        select: { id: true, invoiceDate: true },
      },
    },
  });

  type GroupData = {
    key: string;
    displayNames: Map<string, number>;
    invoiceIds: Set<string>;
    months: Set<string>;
    totalQty: Decimal;
    totalRevenue: Decimal;
    priceSum: Decimal;
    priceCount: number;
  };

  const groups = new Map<string, GroupData>();

  for (const item of items) {
    const key = normalize(item.description);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        displayNames: new Map(),
        invoiceIds: new Set(),
        months: new Set(),
        totalQty: new Decimal(0),
        totalRevenue: new Decimal(0),
        priceSum: new Decimal(0),
        priceCount: 0,
      });
    }
    const g = groups.get(key)!;
    const trimmed = item.description.trim();
    g.displayNames.set(trimmed, (g.displayNames.get(trimmed) ?? 0) + 1);
    g.invoiceIds.add(item.invoice.id);
    g.months.add(item.invoice.invoiceDate.toISOString().slice(0, 7));
    g.totalQty = g.totalQty.plus(new Decimal(item.quantity.toString()));
    g.totalRevenue = g.totalRevenue.plus(new Decimal(item.lineTotal.toString()));
    g.priceSum = g.priceSum.plus(new Decimal(item.unitPrice.toString()));
    g.priceCount += 1;
  }

  function bestDisplayName(g: GroupData): string {
    let name = g.key;
    let max = 0;
    for (const [n, c] of g.displayNames) {
      if (c > max) { max = c; name = n; }
    }
    return name;
  }

  const rows = Array.from(groups.values()).map((g) => ({
    key: g.key,
    displayName: bestDisplayName(g),
    invoiceCount: g.invoiceIds.size,
    totalQty: g.totalQty.toFixed(2),
    totalRevenue: g.totalRevenue.toFixed(2),
    avgPrice: g.priceCount > 0 ? g.priceSum.dividedBy(g.priceCount).toFixed(2) : "0.00",
    monthsActive: g.months.size,
    months: Array.from(g.months).sort(),
  }));

  // Near-duplicate detection: items sharing the same first word
  const byFirstWord = new Map<string, string[]>();
  for (const row of rows) {
    const fw = row.key.split(" ")[0];
    if (!byFirstWord.has(fw)) byFirstWord.set(fw, []);
    byFirstWord.get(fw)!.push(row.key);
  }

  const nearDuplicateGroups: { displayNames: string[] }[] = [];
  for (const [, keys] of byFirstWord) {
    if (keys.length > 1) {
      nearDuplicateGroups.push({
        displayNames: keys.map((k) => bestDisplayName(groups.get(k)!)),
      });
    }
  }

  const rangeMonths = monthsInRange(from, to);

  return NextResponse.json({
    rows,
    nearDuplicateGroups,
    totalLineItems: items.length,
    uniqueDescriptions: rows.length,
    totalMonthsInRange: rangeMonths.length,
  });
}
