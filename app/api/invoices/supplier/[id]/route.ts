import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog, extractMeta, actorFromSession, diffChanges } from "@/lib/audit";
import { computeLineTotals } from "@/lib/money";
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
      // Scoped to what the bill view actually needs (contact info + Zelle
      // for "how to pay") -- bankName/bankAccountNumber/bankRouting/
      // paymentInstructions are compensation-adjacent secrets that don't
      // belong in a response every authenticated role can request, same
      // reasoning as the scrub already applied to GET /api/suppliers.
      supplier: { select: { id: true, name: true, email: true, phone: true, address: true, zelle: true } },
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

  const existing = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A bill that closed out a purchase_request already wrote its cost back
  // to the linked invoice line (app/api/invoices/supplier/route.ts) the
  // moment it was created -- rewriting its items here would desync that
  // write-back (the invoice line's actualCost, and the purchase_request's
  // own cost snapshot, would silently stop matching this bill). Everything
  // else about the bill (notes, due date, our own payment status/amount
  // toward the supplier) is unrelated to that and still freely editable.
  if (existing.purchaseRequestId && parsed.data.items !== undefined) {
    return NextResponse.json(
      { error: "This bill fulfills a purchase request -- its cost is locked. Its other fields can still be edited." },
      { status: 409 }
    );
  }

  const beforeSnapshot = {
    invoiceNumber: existing.invoiceNumber,
    paymentStatus: existing.paymentStatus,
    paidAmount: existing.paidAmount.toString(),
    totalAmount: existing.totalAmount.toString(),
    category: existing.category,
    notes: existing.notes,
  };

  // Once any payment has been recorded, existing line items are financial
  // history -- same reasoning as the customer-invoice equivalent of this
  // guard. Appending a genuinely new line (no id) is still allowed; every
  // incoming item that carries an id must match an existing item
  // byte-for-byte, and every existing item's id must still be present.
  if (parsed.data.items !== undefined && existing.paymentStatus !== "UNPAID") {
    const existingById = new Map(existing.items.map((it) => [it.id, it]));
    const seenIds = new Set<string>();
    for (const item of parsed.data.items) {
      if (!item.id) continue;
      const match = existingById.get(item.id);
      if (!match) continue; // unknown id — treated as a new line below
      seenIds.add(item.id);
      const unchanged =
        match.description === item.description &&
        (match.itemDescription ?? "") === (item.itemDescription ?? "") &&
        new Decimal(match.quantity.toString()).equals(new Decimal(item.quantity || "0")) &&
        new Decimal(match.unitCost.toString()).equals(new Decimal(item.unitCost || "0")) &&
        new Decimal(match.taxRate.toString()).equals(new Decimal(item.taxRate || "0"));
      if (!unchanged) {
        return NextResponse.json(
          { error: "This bill has a recorded payment -- existing line items can't be changed or removed. You can still add new items." },
          { status: 409 }
        );
      }
    }
    for (const existingItem of existing.items) {
      if (!seenIds.has(existingItem.id)) {
        return NextResponse.json(
          { error: "This bill has a recorded payment -- existing line items can't be changed or removed. You can still add new items." },
          { status: 409 }
        );
      }
    }
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
    let subtotal: Decimal;
    let taxAmount: Decimal;
    let computedItems: { description: string; itemDescription?: string; quantity: string; unitCost: string; taxRate: string; lineTotal: string }[];

    try {
      const totals = computeLineTotals(
        data.items.map((item) => ({ quantity: item.quantity, price: item.unitCost, taxRate: item.taxRate }))
      );
      subtotal = totals.subtotal;
      taxAmount = totals.taxAmount;
      computedItems = data.items.map((item, i) => ({
        description: item.description,
        itemDescription: item.itemDescription,
        quantity: item.quantity,
        unitCost: item.unitCost,
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

    if (existing.paymentStatus === "UNPAID") {
      // No money has changed hands yet, so the whole line-item set is still
      // a draft and can be freely rewritten.
      //
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
    } else {
      // A payment already exists: the guard above already proved every
      // incoming item either matches an existing row untouched or has no
      // id at all. Only create rows for the latter -- existing rows are
      // left completely alone rather than being deleted and recreated.
      const existingIds = new Set(existing.items.map((it) => it.id));
      const newItems = data.items
        .map((item, idx) => ({ id: item.id, computed: computedItems[idx] }))
        .filter(({ id }) => !id || !existingIds.has(id))
        .map(({ computed }) => computed);

      if (newItems.length > 0) {
        updateData.items = {
          create: newItems.map((item) => ({
            description: item.description,
            itemDescription: item.itemDescription ?? null,
            quantity: item.quantity,
            unitCost: item.unitCost,
            taxRate: item.taxRate,
            lineTotal: item.lineTotal,
          })),
        };
      }
    }
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

  // Auto-derive paymentStatus when paidAmount or the total (e.g. a newly
  // added item) changes, and the caller didn't explicitly send a status
  // override. Without the totalAmount check, appending an item to a
  // fully-paid bill would leave it displaying "Paid" even though the new
  // item pushed the balance back above zero.
  if (
    (data.paidAmount !== undefined || updateData.totalAmount !== undefined) &&
    data.paymentStatus === undefined
  ) {
    const newPaid = new Decimal(data.paidAmount ?? existing.paidAmount.toString());
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
    // See the matching comment on the GET handler above.
    include: {
      supplier: { select: { id: true, name: true, email: true, phone: true, address: true, zelle: true } },
      items: true,
    },
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

  // Deleting a bill that closed out a purchase_request would leave the
  // linked invoice line's actualCost and the purchase_request's FULFILLED
  // status/cost as orphaned, unrecoverable history -- there's no "reopen"
  // flow to put it back to PENDING. Same reasoning as the payment guard
  // above, just for the purchasing-trigger side of this bill's data.
  if (existing.purchaseRequestId) {
    return NextResponse.json(
      { error: "This bill fulfills a purchase request and can no longer be deleted." },
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
