import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireReadAccess, scopeInvoicesToOwnEmployee } from "@/lib/api";
import { syncProductCatalog } from "@/lib/product-catalog";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { computeLineTotals } from "@/lib/money";
import { claimSequenceNumber } from "@/lib/next-number";
import { ensurePurchaseRequestsForInvoice } from "@/lib/purchase-requests";
import { z } from "zod";
import Decimal from "decimal.js";

const itemSchema = z.object({
  description: z.string().min(1),
  itemDescription: z.string().optional(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number").default("0"),
  // Item code (`XX/PARTNUMBER`) -- supplierId is picked from the supplier
  // dropdown (never free-typed, see the Supplier model's doc comment on
  // `code`), partNumber is free-typed. The actual app UI
  // (invoices/customer/new) requires both client-side for every line a
  // sales rep types in -- deliberately NOT re-required here at the schema
  // level, so any other caller of this endpoint (integration scripts, the
  // existing test suite, a future API consumer) that doesn't know about
  // this feature keeps working exactly as before. A line missing either
  // field simply never gets a purchase_request (see
  // lib/purchase-requests.ts) -- the same graceful-skip this endpoint's
  // PATCH counterpart already relies on for pre-existing invoices.
  supplierId: z.string().optional(),
  partNumber: z.string().optional(),
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
  const access = await requireReadAccess(request, "invoices:customer");
  if (access instanceof NextResponse) return access;

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
  // Company-wide accounting system — every employee sees every invoice,
  // regardless of who it's attributed to.

  const [invoices, total] = await Promise.all([
    prisma.customerInvoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        items: true,
        files: { select: { id: true, originalName: true, mimeType: true } },
      },
      orderBy: { invoiceNumber: "desc" },
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

  // customerId and employeeId are foreign keys the DB will happily reject
  // with a raw constraint-violation error if either references a row that
  // doesn't exist (deleted between page load and submit, a stale cached
  // dropdown value, etc.) -- checked here so that's a clean 400/404
  // instead of an unhandled 500 crashing the whole request.
  const customerExists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customerExists) {
    return NextResponse.json({ error: "Selected customer no longer exists." }, { status: 404 });
  }
  if (employeeId) {
    const employeeExists = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employeeExists) {
      return NextResponse.json(
        { error: "Selected sales rep no longer exists. Please pick another." },
        { status: 400 }
      );
    }
  }

  // Every line's supplierId is a foreign key too -- same reasoning as
  // customerId/employeeId above. Checked as one batch query rather than
  // per-item. Empty/omitted values (supplierId is optional -- see the item
  // schema's doc comment) are excluded rather than treated as an invalid
  // reference.
  const suppliedIds = Array.from(new Set(items.map((i) => i.supplierId).filter((v): v is string => !!v)));
  if (suppliedIds.length > 0) {
    const knownSuppliers = await prisma.supplier.findMany({
      where: { id: { in: suppliedIds } },
      select: { id: true },
    });
    if (knownSuppliers.length !== suppliedIds.length) {
      return NextResponse.json(
        { error: "One or more line items reference a supplier that no longer exists. Refresh and try again." },
        { status: 400 }
      );
    }
  }

  // Duplicate check -- a fast path only. Two requests for the same
  // invoiceNumber/customerId can both pass this check before either has
  // inserted (a classic check-then-act race), so it doesn't by itself
  // guarantee uniqueness; the DB's own unique constraint on
  // (invoiceNumber, customerId) is the real guard, enforced below.
  const existing = await prisma.customerInvoice.findUnique({
    where: { invoiceNumber_customerId: { invoiceNumber, customerId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Invoice number already exists for this customer" },
      { status: 409 }
    );
  }

  const { lines: lineTotals, subtotal, taxAmount } = computeLineTotals(
    items.map((item) => ({ quantity: item.quantity, price: item.unitPrice, taxRate: item.taxRate }))
  );
  const computedItems = items.map((item, i) => ({ ...item, lineTotal: lineTotals[i].lineTotal }));

  // Optional credit-card processing fee from company profile
  let creditCardFee = new Decimal(0);
  let companyProfile: { creditCardFeeRate: unknown; customFees: unknown } | null = null;
  if (addCreditCardFee || appliedFees.length > 0) {
    companyProfile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  }
  if (addCreditCardFee && companyProfile && Number(companyProfile.creditCardFeeRate) > 0) {
    // Card fee applies to the pre-tax subtotal only, matching the
    // accounting system of record -- not to subtotal + tax.
    creditCardFee = subtotal.times(companyProfile.creditCardFeeRate as string);
  }

  // Each fee is applied per-line-item at the client's discretion (e.g. a
  // "delivery fee" toggled on for only some items), so the server can't
  // reproduce the client's exact amount without the per-item selection,
  // which isn't part of this API's payload. It CAN still enforce a hard
  // ceiling: a fee can never legitimately total more than its configured
  // rate times the whole invoice's pre-tax subtotal -- that's the amount if
  // the fee applied to every single line. Anything above that, or a fee id
  // that isn't one of the company's configured fees at all, means the
  // client-submitted amount can't be trusted and is rejected.
  let customFeesSum = new Decimal(0);
  if (appliedFees.length > 0) {
    // The built-in card fee is a company-profile field (creditCardFeeRate),
    // not one of the "custom fees" in customFees -- but the client applies
    // it per-line the same way it applies a custom fee, tagged with the
    // synthetic id "__cc__". Without adding it here, every invoice using the
    // built-in card fee would fail validation as an "unconfigured" fee.
    const configuredFees: { id: string; label: string; rate: number }[] = [
      ...(companyProfile && Number(companyProfile.creditCardFeeRate) > 0
        ? [{ id: "__cc__", label: "CARD FEE", rate: Number(companyProfile.creditCardFeeRate) }]
        : []),
      ...((companyProfile?.customFees as { id: string; label: string; rate: number }[] | null) ?? []),
    ];
    const feeBaseCap = subtotal;
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
      // Rounded to cents like every client-submitted amount is -- comparing
      // against the raw, unrounded product would reject the roughly half of
      // fees whose true value's third decimal digit rounds up (e.g. a true
      // fee of 7.049931 legitimately displays and submits as 7.05, which is
      // "over" the unrounded 7.049931 cap despite being the correct amount).
      const cap = feeBaseCap.times(canonical.rate).toDecimalPlaces(2);
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

  const invoicePrefix =
    (await prisma.companyProfile.findUnique({ where: { id: "default" }, select: { customerInvoicePrefix: true } }))
      ?.customerInvoicePrefix || "INV-2026-";

  // Creating the invoice and claiming its number's sequence value happen in
  // one transaction -- see lib/next-number.ts's claimSequenceNumber doc
  // comment for why this (not a fire-and-forget increment) is what actually
  // guarantees a deleted invoice's number is never reused.
  let invoice;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.customerInvoice.create({
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
              supplierId: item.supplierId,
              partNumber: item.partNumber,
            })),
          },
        },
        include: { customer: true, items: true },
      });
      await claimSequenceNumber(tx, "customerInvoiceNextSeq", invoiceNumber, invoicePrefix);

      // Covers the (currently unused by the UI, but API-reachable) case of
      // creating an invoice that's already paid -- same trigger as the
      // payments POST route and the PATCH route, see
      // lib/purchase-requests.ts.
      if (new Decimal(created.paidAmount.toString()).gt(0)) {
        await ensurePurchaseRequestsForInvoice(tx, created.id);
      }

      return created;
    });
  } catch (err) {
    // The findUnique check above is only a fast path -- it can't stop two
    // concurrent requests for the same invoiceNumber/customerId from both
    // passing it before either has inserted. When that happens, the DB's
    // own unique constraint on (invoiceNumber, customerId) rejects the
    // second insert with a P2002 error. Without this catch that surfaced as
    // an unhandled 500 instead of the same clean 409 the fast path returns.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Invoice number already exists for this customer" },
        { status: 409 }
      );
    }
    throw err;
  }

  const auditActor = { ...actorFromSession(guard), ...extractMeta(request) };

  await writeAuditLog({
    ...auditActor,
    action: "CREATE",
    entityType: "customer_invoice",
    entityId: invoice.id,
    entityLabel: `Invoice #${invoice.invoiceNumber}`,
  });

  // Auto-save each line item to the product catalog.
  try {
    await syncProductCatalog(prisma, items, auditActor);
  } catch {
    // Product sync failure must never break invoice creation
  }

  return NextResponse.json(invoice, { status: 201 });
}
