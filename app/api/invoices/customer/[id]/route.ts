import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api";
import { z } from "zod";
import Decimal from "decimal.js";

const updateSchema = z.object({
  invoiceNumber: z.string().min(1).optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]).optional(),
  paidAmount: z.string().optional(),
  downPayment: z.string().optional(),
  employeeId: z.string().nullable().optional(),
  commissionRate: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
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

  const invoice = await prisma.customerInvoice.findUnique({
    where: { id },
    include: {
      customer: true,
      items: true,
      payments: { orderBy: { paymentDate: "desc" } },
      files: true,
      employee: { select: { id: true, name: true } },
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

  const existing = await prisma.customerInvoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.invoiceNumber) updateData.invoiceNumber = data.invoiceNumber;
  if (data.invoiceDate) updateData.invoiceDate = new Date(data.invoiceDate);
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate);
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.paymentStatus) updateData.paymentStatus = data.paymentStatus;
  if (data.paidAmount !== undefined) updateData.paidAmount = data.paidAmount;
  if (data.downPayment !== undefined) updateData.downPayment = data.downPayment;
  if (data.employeeId !== undefined) updateData.employeeId = data.employeeId;
  if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;

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

    await prisma.customerInvoiceItem.deleteMany({ where: { invoiceId: id } });
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

    try {
      for (const item of data.items) {
        const name = item.description.trim();
        if (!name) continue;
        const existing = await prisma.product.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
        });
        if (!existing) {
          await prisma.product.create({
            data: {
              name,
              description: item.itemDescription ?? null,
              price: item.unitPrice,
              taxRate: item.taxRate,
              active: true,
            },
          });
        }
      }
    } catch {
      // Product sync failure must never break invoice update
    }
  }

  if ((data.paidAmount !== undefined || data.downPayment !== undefined) && data.paymentStatus === undefined) {
    const newPaid = new Decimal(data.paidAmount ?? existing.paidAmount.toString());
    const newDown = new Decimal(data.downPayment ?? existing.downPayment.toString());
    const effectiveTotal = updateData.totalAmount !== undefined
      ? new Decimal(updateData.totalAmount as string)
      : new Decimal(existing.totalAmount.toString());
    const balance = effectiveTotal.minus(newPaid).minus(newDown);

    if (balance.lte(0)) {
      updateData.paymentStatus = "PAID";
    } else if (newPaid.gt(0) || newDown.gt(0)) {
      updateData.paymentStatus = "PARTIALLY_PAID";
    } else {
      updateData.paymentStatus = "UNPAID";
    }
  }

  const updated = await prisma.customerInvoice.update({
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
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  await prisma.customerInvoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
