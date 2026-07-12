import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, scopeInvoicesToOwnEmployee } from "@/lib/api";
import { z } from "zod";
import Decimal from "decimal.js";

const itemSchema = z.object({
  description: z.string().min(1),
  itemDescription: z.string().optional(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number").default("0"),
});

const appliedFeeSchema = z.object({
  id: z.string(),
  label: z.string(),
  rate: z.number(),
  amount: z.string(),
});

const invoiceSchema = z.object({
  customerId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string(),
  dueDate: z.string(),
  items: z.array(itemSchema).min(1),
  notes: z.string().optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]).default("UNPAID"),
  paidAmount: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  downPayment: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  employeeId: z.string().optional().nullable(),
  commissionRate: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  addCreditCardFee: z.boolean().default(false),
  appliedFees: z.array(appliedFeeSchema).default([]),
});

export async function GET(request: Request) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (status) where.paymentStatus = status;
  if (from || to) {
    where.invoiceDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  // SALES only sees invoices linked to their own Employee record.
  const scope = await scopeInvoicesToOwnEmployee(guard);
  if (scope) where.employeeId = scope.employeeId;

  const [invoices, total] = await Promise.all([
    prisma.customerInvoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        items: true,
        files: { select: { id: true, originalName: true, mimeType: true } },
      },
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.customerInvoice.count({ where }),
  ]);

  return NextResponse.json({ invoices, total, page, limit });
}

export async function POST(request: Request) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const body = await request.json();
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    customerId,
    invoiceNumber,
    invoiceDate,
    dueDate,
    items,
    notes,
    paymentStatus,
    paidAmount,
    downPayment,
    commissionRate,
    addCreditCardFee,
    appliedFees,
  } = parsed.data;

  // A SALES caller always gets their own linked Employee record, ignoring
  // whatever employeeId the client submitted -- otherwise they could assign
  // (or attribute commission for) an invoice to a colleague's name, and the
  // horizontal-scoping checks on GET/PATCH/DELETE would exclude their own
  // just-created invoice if it didn't end up linked to them. ADMIN/MANAGER
  // keep assigning whichever salesperson the client-submitted value names.
  let employeeId = parsed.data.employeeId;
  if (guard.user.role === "SALES") {
    const scope = await scopeInvoicesToOwnEmployee(guard);
    employeeId = scope?.employeeId ?? null;
  }

  // Duplicate check
  const existing = await prisma.customerInvoice.findUnique({
    where: { invoiceNumber_customerId: { invoiceNumber, customerId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Invoice number already exists for this customer" },
      { status: 409 }
    );
  }

  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);

  // Round each line's total to 2 decimals FIRST, then sum the already-
  // rounded values into subtotal -- previously subtotal accumulated
  // full-precision Decimals while lineTotal was rounded separately for
  // storage, so the two could legitimately disagree by a cent (e.g. three
  // lines at $3.335 stored as 3.34/3.34/3.34 = $10.02, but a subtotal
  // rounded once from the unrounded sum came out $10.01).
  const computedItems = items.map((item) => {
    const qty = new Decimal(item.quantity);
    const price = new Decimal(item.unitPrice);
    const rate = new Decimal(item.taxRate);
    const lineTotal = qty.times(price).toDecimalPlaces(2);
    const lineTax = lineTotal.times(rate).toDecimalPlaces(2);
    subtotal = subtotal.plus(lineTotal);
    taxAmount = taxAmount.plus(lineTax);
    return { ...item, lineTotal: lineTotal.toFixed(2) };
  });

  // Optional credit-card processing fee from company profile
  let creditCardFee = new Decimal(0);
  let companyProfile: { creditCardFeeRate: unknown; customFees: unknown } | null = null;
  if (addCreditCardFee || appliedFees.length > 0) {
    companyProfile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  }
  if (addCreditCardFee && companyProfile && Number(companyProfile.creditCardFeeRate) > 0) {
    creditCardFee = subtotal.plus(taxAmount).times(companyProfile.creditCardFeeRate as string);
  }

  // Each fee is applied per-line-item at the client's discretion (e.g. a
  // "delivery fee" toggled on for only some items), so the server can't
  // reproduce the client's exact amount without the per-item selection,
  // which isn't part of this API's payload. It CAN still enforce a hard
  // ceiling: a fee can never legitimately total more than its configured
  // rate times the whole invoice base (subtotal + tax) -- that's the
  // amount if the fee applied to every single line. Anything above that,
  // or a fee id that isn't one of the company's configured fees at all,
  // means the client-submitted amount can't be trusted and is rejected.
  let customFeesSum = new Decimal(0);
  if (appliedFees.length > 0) {
    const configuredFees =
      (companyProfile?.customFees as { id: string; label: string; rate: number }[] | null) ?? [];
    const feeBaseCap = subtotal.plus(taxAmount);
    for (const f of appliedFees) {
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
      const cap = feeBaseCap.times(canonical.rate);
      if (amt.gt(cap)) {
        return NextResponse.json(
          { error: `Fee "${f.label}" amount exceeds what its configured rate allows.` },
          { status: 400 }
        );
      }
      customFeesSum = customFeesSum.plus(amt);
    }
  }

  const totalAmount = subtotal.plus(taxAmount).plus(creditCardFee).plus(customFeesSum);

  const invoice = await prisma.customerInvoice.create({
    data: {
      customerId,
      invoiceNumber,
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      creditCardFee: creditCardFee.toFixed(2),
      appliedFees: appliedFees as unknown as object,
      paidAmount: paidAmount ?? "0",
      paymentStatus: paymentStatus ?? "UNPAID",
      downPayment: downPayment ?? "0",
      employeeId: employeeId ?? null,
      commissionRate: commissionRate ?? "0",
      notes,
      items: {
        create: computedItems.map((item) => ({
          description: item.description,
          itemDescription: item.itemDescription ?? null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
        })),
      },
    },
    include: { customer: true, items: true },
  });

  await prisma.companyProfile
    .update({
      where: { id: "default" },
      data: { customerInvoiceNextSeq: { increment: 1 } },
    })
    .catch(() => undefined);

  // Auto-save each line item to the product catalog
  try {
    for (const item of items) {
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
    // Product sync failure must never break invoice creation
  }

  return NextResponse.json(invoice, { status: 201 });
}
