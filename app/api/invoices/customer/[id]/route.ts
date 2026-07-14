import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/api";
import { syncProductCatalog } from "@/lib/product-catalog";
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

// A fee can never legitimately total more than its configured rate times
// feeBase (subtotal + tax) -- the amount if it applied to every line item.
// Rejects an unknown fee id or an amount above that ceiling rather than
// trusting the client-submitted amount outright.
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
    if (amt.gt(feeBase.times(canonical.rate))) {
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

  // Once any payment has been recorded, the line items (and the totals
  // derived from them) are financial history, not a draft -- rewriting them
  // after money has changed hands should go through a correction/void flow,
  // not a silent overwrite. That flow doesn't exist yet, so for now this
  // blocks the dangerous edit outright rather than allowing it silently.
  if (parsed.data.items !== undefined && existing.paymentStatus !== "UNPAID") {
    return NextResponse.json(
      { error: "This invoice has a recorded payment and its line items can no longer be edited." },
      { status: 409 }
    );
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
  if (data.employeeId !== undefined) {
    // employeeId is a foreign key the DB will reject with a raw constraint-
    // violation error if it references a row that doesn't exist -- checked
    // here so that's a clean 400 instead of an unhandled 500.
    if (data.employeeId) {
      const employeeExists = await prisma.employee.findUnique({ where: { id: data.employeeId }, select: { id: true } });
      if (!employeeExists) {
        return NextResponse.json(
          { error: "Selected sales rep no longer exists. Please pick another." },
          { status: 400 }
        );
      }
    }
    updateData.employeeId = data.employeeId || null;
  }
  if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;

  // Each fee is applied per-line-item at the client's discretion, so the
  // server can't reproduce the client's exact amount, but it can enforce a
  // hard ceiling: a fee can never legitimately total more than its
  // configured rate times the invoice base (subtotal + tax) -- the amount
  // if it applied to every line. A fee id that isn't one of the company's
  // currently configured fees, or an amount above that ceiling, means the
  // client-submitted value can't be trusted and the request is rejected.
  // Validated against the *existing* subtotal/tax when the caller isn't
  // also sending new items (below), so a fee can't be smuggled into
  // storage just by leaving items out of the same request.
  let configuredFees: { id: string; label: string; rate: number }[] | null = null;
  if (data.appliedFees !== undefined && data.appliedFees.length > 0) {
    const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
    configuredFees = (profile?.customFees as { id: string; label: string; rate: number }[] | null) ?? [];
    if (!(data.items && data.items.length > 0)) {
      const feeBase = new Decimal(existing.subtotal.toString()).plus(existing.taxAmount.toString());
      const err = validateAppliedFees(data.appliedFees, feeBase, configuredFees);
      if (err) return err;
    }
  }
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
        // Round to 2 decimals FIRST, then sum the already-rounded values
        // into subtotal/taxAmount -- same fix as invoice creation.
        const lineTotal = qty.times(price).toDecimalPlaces(2);
        const lineTax = lineTotal.times(rate).toDecimalPlaces(2);
        subtotal = subtotal.plus(lineTotal);
        taxAmount = taxAmount.plus(lineTax);
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
    if (data.appliedFees !== undefined && data.appliedFees.length > 0 && configuredFees) {
      const err = validateAppliedFees(data.appliedFees, subtotal.plus(taxAmount), configuredFees);
      if (err) return err;
      for (const f of data.appliedFees) feesSum = feesSum.plus(f.amount);
    }

    updateData.subtotal = subtotal.toFixed(2);
    updateData.taxAmount = taxAmount.toFixed(2);
    updateData.totalAmount = subtotal.plus(taxAmount).plus(feesSum).toFixed(2);

    // The delete and the create used to be two separate statements (an
    // eager deleteMany() here, then a create nested in the update() call
    // below) -- a crash or error between them permanently lost the
    // invoice's line items while the parent record survived with stale
    // totals. Both are now nested inside the single customerInvoice.update()
    // call's relation write instead: Prisma runs a nested relation write
    // (deleteMany + create on the same relation, in one .update() call) as
    // one atomic transaction, so there's no longer a window where the
    // items are gone but the parent hasn't been updated yet.
    updateData.items = {
      deleteMany: {},
      create: computedItems.map((item) => ({
        description: item.description,
        itemDescription: item.itemDescription ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        lineTotal: item.lineTotal,
      })),
    };

    // Auto-save new line items to the product catalog.
    try {
      await syncProductCatalog(prisma, data.items);
    } catch {
      // Product sync failure must never break invoice update
    }
  }

  // Reject an amount that would exceed what's actually owed, rather than
  // silently absorbing the difference -- there's no credit-balance concept
  // in this codebase to represent "the customer overpaid by $X", so an
  // over-cap value has nowhere correct to go and previously just vanished
  // from the system's perspective.
  if (data.paidAmount !== undefined || data.downPayment !== undefined) {
    const newPaid = new Decimal(data.paidAmount ?? existing.paidAmount.toString());
    const newDown = new Decimal(data.downPayment ?? existing.downPayment.toString());
    const effectiveTotal = updateData.totalAmount !== undefined
      ? new Decimal(updateData.totalAmount as string)
      : new Decimal(existing.totalAmount.toString());
    if (newPaid.plus(newDown).gt(effectiveTotal)) {
      return NextResponse.json(
        { error: "paidAmount plus downPayment cannot exceed the invoice total." },
        { status: 400 }
      );
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

  // An invoice with a recorded payment is a financial record, not a draft
  // -- deleting it destroys the only evidence money was collected against
  // it. Same reasoning as the PATCH guard above.
  if (existing.paymentStatus !== "UNPAID") {
    return NextResponse.json(
      { error: "This invoice has a recorded payment and can no longer be deleted." },
      { status: 409 }
    );
  }

  await prisma.customerInvoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
