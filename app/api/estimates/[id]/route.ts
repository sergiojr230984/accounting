import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { computeLineTotals } from "@/lib/money";
import { claimSequenceNumber } from "@/lib/next-number";
import { z } from "zod";
import type Decimal from "decimal.js";

const ESTIMATE_PREFIX = `EST-${new Date().getFullYear()}-`;

const updateSchema = z.object({
  estimateNumber: z.string().min(1).optional(),
  estimateDate: z.string().optional(),
  expiryDate: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"]).optional(),
  notes: z.string().optional(),
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

    updateData.subtotal = subtotal.toFixed(2);
    updateData.taxAmount = taxAmount.toFixed(2);
    updateData.totalAmount = subtotal.plus(taxAmount).toFixed(2);

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
