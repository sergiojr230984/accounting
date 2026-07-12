import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole, scopeInvoicesToOwnEmployee } from "@/lib/api";
import { z } from "zod";
import Decimal from "decimal.js";

const appliedFeeSchema = z.object({
  id: z.string(),
  label: z.string(),
  rate: z.number(),
  amount: z.string(),
});

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
  customerAddress: z.string().optional().nullable(),
  appliedFees: z.array(appliedFeeSchema).optional(),
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
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

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

  const scope = await scopeInvoicesToOwnEmployee(guard);
  if (scope && invoice.employeeId !== scope.employeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(invoice);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.customerInvoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scope = await scopeInvoicesToOwnEmployee(guard);
  if (scope && existing.employeeId !== scope.employeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.invoiceNumber) updateData.invoiceNumber = data.invoiceNumber;
  if (data.invoiceDate) updateData.invoiceDate = new Date(data.invoiceDate);
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate);
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.paymentStatus) updateData.paymentStatus = data.paymentStatus;

  if (data.customerAddress !== undefined) {
    await prisma.customer.update({
      where: { id: existing.customerId },
      data: { address: data.customerAddress },
    }).catch(() => undefined);
  }
  if (data.paidAmount !== undefined) updateData.paidAmount = data.paidAmount;
  if (data.downPayment !== undefined) updateData.downPayment = data.downPayment;
  if (data.employeeId !== undefined) updateData.employeeId = data.employeeId || null;
  if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;
  if (data.appliedFees !== undefined) updateData.appliedFees = data.appliedFees as unknown as object;

  // Only touch line items if the client actually sent a non-empty array.
  // IMPORTANT: compute and validate items BEFORE any destructive DB operation
  // so that a bad value can never leave the invoice with no items.
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

    let feesSum = new Decimal(0);
    for (const f of data.appliedFees ?? []) {
      try {
        feesSum = feesSum.plus(new Decimal(f.amount));
      } catch {
        // skip malformed entry
      }
    }

    updateData.subtotal = subtotal.toFixed(2);
    updateData.taxAmount = taxAmount.toFixed(2);
    updateData.totalAmount = subtotal.plus(taxAmount).plus(feesSum).toFixed(2);

    // Delete existing items only AFTER successful computation
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

    // Auto-save new line items to the product catalog
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

  // Auto-derive paymentStatus when paidAmount or downPayment changes and the
  // caller didn't explicitly send a status override.
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
  const guard = await requireRole("ADMIN", "MANAGER", "SALES");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  const existing = await prisma.customerInvoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scope = await scopeInvoicesToOwnEmployee(guard);
  if (scope && existing.employeeId !== scope.employeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.customerInvoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
