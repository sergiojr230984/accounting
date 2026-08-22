import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { computeLineTotals } from "@/lib/money";
import { claimSequenceNumber } from "@/lib/next-number";
import { z } from "zod";
import Decimal from "decimal.js";

const ESTIMATE_PREFIX = `EST-${new Date().getFullYear()}-`;

const appliedFeeSchema = z.object({
  id: z.string(),
  label: z.string(),
  rate: z.number(),
  amount: z.string(),
});

const updateSchema = z.object({
  estimateNumber: z.string().min(1).optional(),
  estimateDate: z.string().optional(),
  expiryDate: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"]).optional(),
  notes: z.string().optional(),
  appliedFees: z.array(appliedFeeSchema).optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        itemDescription: z.string().optional(),
        quantity: z.string(),
        unitPrice: z.string(),
        taxRate: z.string().default("0"),
      })
    )
    .optional(),
});

// A fee can never legitimately total more than its configured rate times
// feeBase (the pre-tax subtotal) -- the amount if it applied to every line
// item. Mirrors the same guard on customer invoices
// (app/api/invoices/customer/[id]/route.ts).
function validateAppliedFees(
  fees: { id: string; label: string; amount: string }[],
  feeBase: Decimal,
  configuredFees: { id: string; label: string; rate: number }[]
): NextResponse | null {
  for (const f of fees) {
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
    const cap = feeBase.times(canonical.rate).toDecimalPlaces(2);
    if (amt.gt(cap)) {
      return NextResponse.json(
        { error: `Fee "${f.label}" amount exceeds what its configured rate allows.` },
        { status: 400 }
      );
    }
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initializeDatabase();

  const { id } = await params;
  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: { customer: true, items: true },
  });

  if (!estimate) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(estimate);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initializeDatabase();

  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.estimate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.estimateNumber) updateData.estimateNumber = data.estimateNumber;
  if (data.estimateDate) updateData.estimateDate = new Date(data.estimateDate);
  if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
  if (data.status) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes;

  // Each fee is applied per-line-item at the client's discretion, so the
  // server can't reproduce the client's exact amount, but it can enforce a
  // hard ceiling -- see validateAppliedFees above. Validated against the
  // *existing* subtotal when the caller isn't also sending new items
  // (below), so a fee can't be smuggled into storage just by leaving items
  // out of the same request. Mirrors app/api/invoices/customer/[id]/route.ts.
  let configuredFees: { id: string; label: string; rate: number }[] | null = null;
  if (data.appliedFees !== undefined && data.appliedFees.length > 0) {
    const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
    configuredFees = [
      ...(profile && Number(profile.creditCardFeeRate) > 0
        ? [{ id: "__cc__", label: "CARD FEE", rate: Number(profile.creditCardFeeRate) }]
        : []),
      ...((profile?.customFees as { id: string; label: string; rate: number }[] | null) ?? []),
    ];
    if (!(data.items && data.items.length > 0)) {
      const feeBase = new Decimal(existing.subtotal.toString());
      const err = validateAppliedFees(data.appliedFees, feeBase, configuredFees);
      if (err) return err;
    }
  }
  if (data.appliedFees !== undefined) updateData.appliedFees = data.appliedFees as unknown as object;

  // A fee-only PATCH (no items in the same request) still changes the
  // total -- recompute it off the existing subtotal/tax here, since the
  // items branch below (which owns totalAmount when items ARE sent) won't
  // run. Also covers clearing every fee (appliedFees: []), which must pull
  // the total back down to subtotal + tax.
  if (data.appliedFees !== undefined && !(data.items && data.items.length > 0)) {
    const feesSum = data.appliedFees.reduce((acc, f) => acc.plus(f.amount), new Decimal(0));
    updateData.totalAmount = new Decimal(existing.subtotal.toString())
      .plus(existing.taxAmount.toString())
      .plus(feesSum)
      .toFixed(2);
  }

  if (data.items && data.items.length > 0) {
    let subtotal: Decimal;
    let taxAmount: Decimal;
    let computedItems: { description: string; itemDescription?: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string }[];

    try {
      const totals = computeLineTotals(
        data.items.map((item) => ({ quantity: item.quantity, price: item.unitPrice, taxRate: item.taxRate }))
      );
      subtotal = totals.subtotal;
      taxAmount = totals.taxAmount;
      computedItems = data.items.map((item, i) => ({
        description: item.description,
        itemDescription: item.itemDescription,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        lineTotal: totals.lines[i].lineTotal,
      }));
    } catch {
      return NextResponse.json(
        { error: "Invalid item values — please check quantities and prices" },
        { status: 400 }
      );
    }

    let feesSum = new Decimal(0);
    if (data.appliedFees !== undefined && data.appliedFees.length > 0 && configuredFees) {
      const err = validateAppliedFees(data.appliedFees, subtotal, configuredFees);
      if (err) return err;
      for (const f of data.appliedFees) feesSum = feesSum.plus(f.amount);
    }

    updateData.subtotal = subtotal.toFixed(2);
    updateData.taxAmount = taxAmount.toFixed(2);
    updateData.totalAmount = subtotal.plus(taxAmount).plus(feesSum).toFixed(2);

    await prisma.estimateItem.deleteMany({ where: { estimateId: id } });
    updateData.items = {
      create: computedItems.map((item) => ({
        description: item.description,
        itemDescription: item.itemDescription ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        lineTotal: item.lineTotal,
      })),
    };
  }

  // If the estimate number is being changed here, the sequence counter
  // still needs to account for it -- see claimSequenceNumber's doc comment
  // in lib/next-number.ts.
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.estimate.update({
      where: { id },
      data: updateData,
      include: { customer: true, items: true },
    });
    if (data.estimateNumber) {
      await claimSequenceNumber(tx, "estimateNextSeq", data.estimateNumber, ESTIMATE_PREFIX);
    }
    return result;
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initializeDatabase();

  const { id } = await params;
  await prisma.estimate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
