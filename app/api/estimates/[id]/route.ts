import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import Decimal from "decimal.js";

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
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);
    let computedItems: { description: string; itemDescription?: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string }[];

    try {
      computedItems = data.items.map((item) => {
        const qty = new Decimal(item.quantity || "0");
        const price = new Decimal(item.unitPrice || "0");
        const rate = new Decimal(item.taxRate || "0");
        const lineTotal = qty.times(price);
        subtotal = subtotal.plus(lineTotal);
        taxAmount = taxAmount.plus(lineTotal.times(rate));
        return {
          description: item.description,
          itemDescription: item.itemDescription,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          lineTotal: lineTotal.toFixed(2),
        };
      });
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

  const updated = await prisma.estimate.update({
    where: { id },
    data: updateData,
    include: { customer: true, items: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.estimate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
