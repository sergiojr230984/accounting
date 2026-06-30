import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import Decimal from "decimal.js";

const updateSchema = z.object({
  invoiceNumber: z.string().min(1).optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  category: z.enum(["COGS", "SERVICES_EXPENSE", "OPERATING_EXPENSE", "OTHER"]).optional(),
  notes: z.string().optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]).optional(),
  paidAmount: z.string().optional(),
  customerInvoiceRef: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        description: z.string().min(1),
        itemDescription: z.string().optional(),
        quantity: z.string(),
        unitCost: z.string(),
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

  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: true,
      payments: { orderBy: { paymentDate: "desc" } },
      files: true,
    },
  });

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(invoice);
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

  const existing = await prisma.supplierInvoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.invoiceNumber) updateData.invoiceNumber = data.invoiceNumber;
  if (data.invoiceDate) updateData.invoiceDate = new Date(data.invoiceDate);
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.category) updateData.category = data.category;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.paymentStatus) updateData.paymentStatus = data.paymentStatus;
  if (data.paidAmount !== undefined) updateData.paidAmount = data.paidAmount;
  if (data.customerInvoiceRef !== undefined) updateData.customerInvoiceRef = data.customerInvoiceRef || null;

  if (data.items && data.items.length > 0) {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);
    let computedItems: { description: string; itemDescription?: string; quantity: string; unitCost: string; taxRate: string; lineTotal: string }[];

    try {
      computedItems = data.items.map((item) => {
        const qty = new Decimal(item.quantity || "0");
        const cost = new Decimal(item.unitCost || "0");
        const rate = new Decimal(item.taxRate || "0");
        const lineTotal = qty.times(cost);
        subtotal = subtotal.plus(lineTotal);
        taxAmount = taxAmount.plus(lineTotal.times(rate));
        return {
          description: item.description,
          itemDescription: item.itemDescription,
          quantity: item.quantity,
          unitCost: item.unitCost,
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

    await prisma.supplierInvoiceItem.deleteMany({ where: { invoiceId: id } });
    updateData.items = {
      create: computedItems.map((item) => ({
        description: item.description,
        itemDescription: item.itemDescription ?? null,
        quantity: item.quantity,
        unitCost: item.unitCost,
        taxRate: item.taxRate,
        lineTotal: item.lineTotal,
      })),
    };
  }

  if (data.paidAmount !== undefined && data.paymentStatus === undefined) {
    const newPaid = new Decimal(data.paidAmount);
    const effectiveTotal = updateData.totalAmount !== undefined
      ? new Decimal(updateData.totalAmount as string)
      : new Decimal(existing.totalAmount.toString());
    const balance = effectiveTotal.minus(newPaid);

    if (balance.lte(0)) {
      updateData.paymentStatus = "PAID";
    } else if (newPaid.gt(0)) {
      updateData.paymentStatus = "PARTIALLY_PAID";
    } else {
      updateData.paymentStatus = "UNPAID";
    }
  }

  const updated = await prisma.supplierInvoice.update({
    where: { id },
    data: updateData,
    include: { supplier: true, items: true },
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
  await prisma.supplierInvoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
