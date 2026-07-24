import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog, extractMeta, actorFromSession, diffChanges } from "@/lib/audit";
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

  const beforeSnapshot = {
    invoiceNumber: existing.invoiceNumber,
    paymentStatus: existing.paymentStatus,
    paidAmount: existing.paidAmount.toString(),
    totalAmount: existing.totalAmount.toString(),
    category: existing.category,
    notes: existing.notes,
  };

  // Once any payment has been recorded, line items (and the totals derived
  // from them) are financial history -- same reasoning as the customer-
  // invoice equivalent of this guard.
  if (parsed.data.items !== undefined && existing.paymentStatus !== "UNPAID") {
    return NextResponse.json(
      { error: "This bill has a recorded payment and its line items can no longer be edited." },
      { status: 409 }
    );
  }

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
        // Round to 2 decimals FIRST, then sum the already-rounded values
        // into subtotal/taxAmount -- same fix as invoice creation.
        const lineTotal = qty.times(cost).toDecimalPlaces(2);
        const lineTax = lineTotal.times(rate).toDecimalPlaces(2);
        subtotal = subtotal.plus(lineTotal);
        taxAmount = taxAmount.plus(lineTax);
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

    // Nested inside the single supplierInvoice.update() call's relation
    // write (rather than a separate eager deleteMany() statement before
    // it) so the delete+create runs as one atomic transaction -- same fix
    // as the customer-invoice equivalent of this pattern.
    updateData.items = {
      deleteMany: {},
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

  // Reject an amount that would exceed what's actually owed -- same
  // reasoning as the customer-invoice equivalent of this check.
  if (data.paidAmount !== undefined) {
    const newPaid = new Decimal(data.paidAmount);
    const effectiveTotal = updateData.totalAmount !== undefined
      ? new Decimal(updateData.totalAmount as string)
      : new Decimal(existing.totalAmount.toString());
    if (newPaid.gt(effectiveTotal)) {
      return NextResponse.json(
        { error: "paidAmount cannot exceed the bill total." },
        { status: 400 }
      );
    }
  }

  // Auto-derive paymentStatus when paidAmount changes and the caller didn't
  // explicitly send a status override.
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

  await writeAuditLog({
    ...actorFromSession(session),
    action: "UPDATE",
    entityType: "supplier_invoice",
    entityId: id,
    entityLabel: `Bill #${updated.invoiceNumber}`,
    changes: diffChanges(beforeSnapshot, {
      invoiceNumber: updated.invoiceNumber,
      paymentStatus: updated.paymentStatus,
      paidAmount: updated.paidAmount.toString(),
      totalAmount: updated.totalAmount.toString(),
      category: updated.category,
      notes: updated.notes,
    }),
    ...extractMeta(request),
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await prisma.supplierInvoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing.paymentStatus !== "UNPAID") {
    return NextResponse.json(
      { error: "This bill has a recorded payment and can no longer be deleted." },
      { status: 409 }
    );
  }

  await prisma.supplierInvoice.delete({ where: { id } });

  await writeAuditLog({
    ...actorFromSession(session),
    action: "DELETE",
    entityType: "supplier_invoice",
    entityId: id,
    entityLabel: `Bill #${existing.invoiceNumber}`,
    ...extractMeta(request),
  });

  return NextResponse.json({ ok: true });
}
