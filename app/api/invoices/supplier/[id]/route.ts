import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
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
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        description: z.string().min(1),
        quantity: z.string(),
        unitCost: z.string(),
        taxRate: z.string().default("0"),
      })
    )
    .optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = requirePermission(session, "supplier_invoice", "read");
  if (!allowed) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "supplier_invoice", entityLabel: "View Bill", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const { allowed } = requirePermission(session, "supplier_invoice", "update");
  if (!allowed) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "supplier_invoice", entityLabel: "Update Bill", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (data.invoiceNumber) updateData.invoiceNumber = data.invoiceNumber;
  if (data.invoiceDate) updateData.invoiceDate = new Date(data.invoiceDate);
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.category) updateData.category = data.category;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.paymentStatus) updateData.paymentStatus = data.paymentStatus;
  if (data.paidAmount !== undefined) updateData.paidAmount = data.paidAmount;

  if (data.items) {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);

    const computedItems = data.items.map((item) => {
      const qty = new Decimal(item.quantity);
      const cost = new Decimal(item.unitCost);
      const rate = new Decimal(item.taxRate);
      const lineTotal = qty.times(cost);
      subtotal = subtotal.plus(lineTotal);
      taxAmount = taxAmount.plus(lineTotal.times(rate));
      return { ...item, lineTotal: lineTotal.toFixed(2) };
    });

    updateData.subtotal = subtotal.toFixed(2);
    updateData.taxAmount = taxAmount.toFixed(2);
    updateData.totalAmount = subtotal.plus(taxAmount).toFixed(2);

    await prisma.supplierInvoiceItem.deleteMany({ where: { invoiceId: id } });
    updateData.items = {
      create: computedItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitCost: item.unitCost,
        taxRate: item.taxRate,
        lineTotal: item.lineTotal,
      })),
    };
  }

  const updated = await prisma.supplierInvoice.update({
    where: { id },
    data: updateData,
    include: { supplier: true, items: true },
  });

  const afterSnapshot = {
    invoiceNumber: updated.invoiceNumber,
    paymentStatus: updated.paymentStatus,
    paidAmount: updated.paidAmount.toString(),
    totalAmount: updated.totalAmount.toString(),
    category: updated.category,
    notes: updated.notes,
  };

  await writeAuditLog({
    ...actorFromSession(session),
    action: "UPDATE",
    entityType: "supplier_invoice",
    entityId: id,
    entityLabel: `Bill #${updated.invoiceNumber}`,
    changes: diffChanges(beforeSnapshot, afterSnapshot),
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

  const { allowed } = requirePermission(session, "supplier_invoice", "delete");
  if (!allowed) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "supplier_invoice", entityLabel: "Delete Bill", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.supplierInvoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
