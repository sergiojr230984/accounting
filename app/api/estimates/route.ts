import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireReadAccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { computeLineTotals } from "@/lib/money";
import { claimSequenceNumber } from "@/lib/next-number";
import { z } from "zod";
import Decimal from "decimal.js";

const ESTIMATE_PREFIX = `EST-${new Date().getFullYear()}-`;

const itemSchema = z.object({
  description: z.string().min(1),
  itemDescription: z.string().optional(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number").default("0"),
});

const appliedFeeSchema = z.object({
  id: z.string(),
  label: z.string(),
  rate: z.number(),
  amount: z.string(),
});

const estimateSchema = z.object({
  customerId: z.string().min(1),
  estimateNumber: z.string().min(1),
  estimateDate: z.string(),
  expiryDate: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
  notes: z.string().optional(),
  appliedFees: z.array(appliedFeeSchema).default([]),
});

export async function GET(request: Request) {
  const access = await requireReadAccess(request, "estimates");
  if (access instanceof NextResponse) return access;

  await initializeDatabase();

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;

  const [estimates, total] = await Promise.all([
    prisma.estimate.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        items: true,
      },
      // estimateNumber is free-typed (see estimates/new's input), not a
      // guaranteed-consistent zero-padded sequence -- sorting on it
      // lexicographically means an estimate numbered without the usual
      // prefix sorts far from its chronological neighbors and can look like
      // it's missing from the top of the list. createdAt reflects actual
      // creation order regardless of what was typed into the number field;
      // see app/api/invoices/customer/route.ts for the same fix applied to
      // customer invoices (and .../supplier/route.ts, which already sorted
      // this way).
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.estimate.count({ where }),
  ]);

  return NextResponse.json({ estimates, total, page, limit });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initializeDatabase();

  const body = await request.json();
  const parsed = estimateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { customerId, estimateNumber, estimateDate, expiryDate, items, notes, appliedFees } = parsed.data;

  // customerId is a foreign key the DB will reject with a raw constraint-
  // violation error if it references a row that doesn't exist -- checked
  // here so that's a clean 404 instead of an unhandled 500.
  const customerExists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customerExists) {
    return NextResponse.json({ error: "Selected customer no longer exists." }, { status: 404 });
  }

  const existing = await prisma.estimate.findUnique({
    where: { estimateNumber_customerId: { estimateNumber, customerId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Estimate number already exists for this customer" },
      { status: 409 }
    );
  }

  const { lines: lineTotals, subtotal, taxAmount } = computeLineTotals(
    items.map((item) => ({ quantity: item.quantity, price: item.unitPrice, taxRate: item.taxRate }))
  );
  const computedItems = items.map((item, i) => ({ ...item, lineTotal: lineTotals[i].lineTotal }));

  // Each fee is applied per-line-item at the client's discretion (e.g. a
  // "delivery fee" toggled on for only some items), so the server can't
  // reproduce the client's exact amount without the per-item selection,
  // which isn't part of this API's payload. It CAN still enforce a hard
  // ceiling: a fee can never legitimately total more than its configured
  // rate times the whole estimate's pre-tax subtotal -- that's the amount if
  // the fee applied to every single line. Anything above that, or a fee id
  // that isn't one of the company's configured fees at all, means the
  // client-submitted amount can't be trusted and is rejected. Mirrors the
  // same validation on customer invoices (app/api/invoices/customer/route.ts).
  let feesSum = new Decimal(0);
  if (appliedFees.length > 0) {
    const companyProfile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
    const configuredFees: { id: string; label: string; rate: number }[] = [
      ...(companyProfile && Number(companyProfile.creditCardFeeRate) > 0
        ? [{ id: "__cc__", label: "CARD FEE", rate: Number(companyProfile.creditCardFeeRate) }]
        : []),
      ...((companyProfile?.customFees as { id: string; label: string; rate: number }[] | null) ?? []),
    ];
    for (const f of appliedFees) {
      const canonical = configuredFees.find((cf) => cf.id === f.id);
      if (!canonical) {
        return NextResponse.json(
          { error: `Fee "${f.label}" is not a currently configured fee. Refresh and try again.` },
          { status: 400 }
        );
      }
      let amt: Decimal;
      try {
        amt = new Decimal(f.amount);
      } catch {
        return NextResponse.json({ error: `Invalid amount for fee "${f.label}".` }, { status: 400 });
      }
      // Rounded to cents like every client-submitted amount is -- see the
      // matching comment in app/api/invoices/customer/route.ts.
      const cap = subtotal.times(canonical.rate).toDecimalPlaces(2);
      if (amt.gt(cap)) {
        return NextResponse.json(
          { error: `Fee "${f.label}" amount exceeds what its configured rate allows.` },
          { status: 400 }
        );
      }
      feesSum = feesSum.plus(amt);
    }
  }

  const totalAmount = subtotal.plus(taxAmount).plus(feesSum);

  // Creating the estimate and claiming its number's sequence value happen
  // in one transaction -- see lib/next-number.ts's claimSequenceNumber doc
  // comment for why this is what actually guarantees a deleted estimate's
  // number is never reused.
  const estimate = await prisma.$transaction(async (tx) => {
    const created = await tx.estimate.create({
      data: {
        customerId,
        estimateNumber,
        estimateDate: new Date(estimateDate),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        appliedFees: appliedFees as unknown as object,
        notes,
        items: {
          create: computedItems.map((item) => ({
            description: item.description,
            itemDescription: item.itemDescription ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            lineTotal: item.lineTotal,
          })),
        },
      },
      include: { customer: true, items: true },
    });
    await claimSequenceNumber(tx, "estimateNextSeq", estimateNumber, ESTIMATE_PREFIX);
    return created;
  });

  return NextResponse.json(estimate, { status: 201 });
}
