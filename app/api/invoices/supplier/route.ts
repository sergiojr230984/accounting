import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireReadAccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { computeLineTotals } from "@/lib/money";
import { z } from "zod";
import Decimal from "decimal.js";

const itemSchema = z.object({
  description: z.string().min(1),
  itemDescription: z.string().optional(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  unitCost: z.string().regex(/^\d+(\.\d+)?$/),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
});

const invoiceSchema = z.object({
  supplierId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string(),
  dueDate: z.string().optional(),
  category: z.enum(["COGS", "SERVICES_EXPENSE", "OPERATING_EXPENSE", "OTHER"]),
  items: z.array(itemSchema).min(1),
  notes: z.string().optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]).default("UNPAID"),
  paidAmount: z.string().default("0"),
  customerInvoiceRef: z.string().optional(),
  // Set when this bill is being created to close out a specific pending
  // purchase_request (the "Create Bill" action on the Items Ordered /
  // Pending report) -- see the strict 1:1 handling in POST below.
  purchaseRequestId: z.string().optional(),
});

export async function GET(request: Request) {
  const access = await requireReadAccess(request, "invoices:supplier");
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const supplierId = searchParams.get("supplierId");
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const where: Record<string, unknown> = {};
  if (supplierId) where.supplierId = supplierId;
  if (category) where.category = category;
  if (status) where.paymentStatus = status;
  if (from || to) {
    where.invoiceDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const [invoices, total] = await Promise.all([
    prisma.supplierInvoice.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
        files: { select: { id: true, originalName: true, mimeType: true } },
      },
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.supplierInvoice.count({ where }),
  ]);

  return NextResponse.json({ invoices, total, page, limit });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    supplierId,
    invoiceNumber,
    invoiceDate,
    dueDate,
    category,
    items,
    notes,
    paymentStatus,
    paidAmount,
    customerInvoiceRef,
    purchaseRequestId,
  } = parsed.data;

  // A bill that closes out a purchase_request is strictly 1:1 with the
  // invoice line it fulfills (one cost, one supplier, one part number) --
  // the general multi-item bill flow doesn't apply to it. Checked here,
  // before the transaction, since it doesn't depend on the request's
  // current (locked) state.
  if (purchaseRequestId && items.length !== 1) {
    return NextResponse.json(
      { error: "A bill fulfilling a purchase request must have exactly one line item." },
      { status: 400 }
    );
  }

  // supplierId is a foreign key the DB will reject with a raw constraint-
  // violation error if it references a row that doesn't exist -- checked
  // here so that's a clean 404 instead of an unhandled 500.
  const supplierExists = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplierExists) {
    return NextResponse.json({ error: "Selected supplier no longer exists." }, { status: 404 });
  }

  const existing = await prisma.supplierInvoice.findUnique({
    where: { invoiceNumber_supplierId: { invoiceNumber, supplierId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Invoice number already exists for this supplier" },
      { status: 409 }
    );
  }

  const { lines: lineTotals, subtotal, taxAmount } = computeLineTotals(
    items.map((item) => ({ quantity: item.quantity, price: item.unitCost, taxRate: item.taxRate }))
  );
  const computedItems = items.map((item, i) => ({ ...item, lineTotal: lineTotals[i].lineTotal }));

  const totalAmount = subtotal.plus(taxAmount);

  // Creation and the PO-number counter bump (and, when this bill closes out
  // a purchase request, the cost write-back + status flip) happen in one
  // transaction -- previously the counter bump was fire-and-forget with a
  // silently-swallowed error, which could leave the counter under-advanced
  // with no visible failure. This bill's own invoiceNumber is usually the
  // *supplier's* number, not ours, so (unlike customer invoices/estimates)
  // the counter here isn't derived from parsing it -- it's a simple +1 per
  // bill created, same as before, just no longer allowed to fail silently.
  let result: {
    error: "pr_not_found" | "pr_already_fulfilled" | "pr_supplier_mismatch" | null;
    invoice?: Prisma.SupplierInvoiceGetPayload<{ include: { supplier: { select: { id: true; name: true } }; items: true } }>;
    warning?: string | null;
  };
  try {
    result = await prisma.$transaction(async (tx) => {
      let purchaseRequest: {
        id: string;
        customerInvoiceItemId: string;
        supplierId: string;
        partNumber: string;
        quantity: Prisma.Decimal;
        customerInvoiceNumber: string;
      } | null = null;
      let warning: string | null = null;

      if (purchaseRequestId) {
        // Row lock -- serializes a concurrent double-submit (double-click,
        // retry) against the SAME purchase request, same technique as the
        // estimate->invoice conversion route
        // (app/api/estimates/[id]/convert/route.ts).
        await tx.$queryRaw`SELECT "id" FROM "PurchaseRequest" WHERE "id" = ${purchaseRequestId} FOR UPDATE`;
        const pr = await tx.purchaseRequest.findUnique({
          where: { id: purchaseRequestId },
          include: { customerInvoice: { select: { invoiceNumber: true } } },
        });
        if (!pr) return { error: "pr_not_found" as const };
        // @unique on SupplierInvoice.purchaseRequestId is the DB-level
        // backstop for this same rule -- checked here first so a second
        // attempt gets a clean, specific 409 instead of a raw constraint
        // error.
        if (pr.status !== "PENDING") return { error: "pr_already_fulfilled" as const };
        if (pr.supplierId !== supplierId) return { error: "pr_supplier_mismatch" as const };
        purchaseRequest = {
          id: pr.id,
          customerInvoiceItemId: pr.customerInvoiceItemId,
          supplierId: pr.supplierId,
          partNumber: pr.partNumber,
          quantity: pr.quantity,
          customerInvoiceNumber: pr.customerInvoice.invoiceNumber,
        };

        // Bill qty is expected to always equal the invoice line's qty --
        // sales confirms supplier stock before invoicing, so there's no
        // partial-fulfillment state machine here. A mismatch is still
        // allowed through (most likely a data-entry slip), just flagged.
        if (!new Decimal(items[0].quantity).equals(new Decimal(pr.quantity.toString()))) {
          warning = `Entered quantity (${items[0].quantity}) differs from the invoice line's quantity (${pr.quantity.toString()}).`;
        }
      }

      const created = await tx.supplierInvoice.create({
        data: {
          supplierId,
          invoiceNumber,
          invoiceDate: new Date(invoiceDate),
          dueDate: dueDate ? new Date(dueDate) : null,
          category,
          subtotal: subtotal.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          paidAmount,
          paymentStatus,
          notes,
          // Reuses the existing bill<->invoice display mechanism (the free-
          // text customerInvoiceRef the "Invoice Profitability" report
          // already matches against) rather than duplicating it -- when
          // this bill closes out a purchase request, it's auto-derived from
          // that request's own invoice, ignoring whatever the client sent.
          customerInvoiceRef: purchaseRequest ? purchaseRequest.customerInvoiceNumber : customerInvoiceRef || null,
          purchaseRequestId: purchaseRequest?.id ?? null,
          items: {
            create: computedItems.map((item) => ({
              description: item.description,
              itemDescription: item.itemDescription ?? null,
              quantity: item.quantity,
              unitCost: item.unitCost,
              taxRate: item.taxRate,
              lineTotal: item.lineTotal,
              partNumber: purchaseRequest?.partNumber ?? null,
            })),
          },
        },
        // Narrowed select -- the create response's supplier field is unused
        // by the client (it just reads the new bill's id and redirects), so
        // bank account/routing/Zelle details have no reason to be in this
        // response at all, let alone unscoped by role.
        include: { supplier: { select: { id: true, name: true } }, items: true },
      });
      await tx.companyProfile.update({
        where: { id: "default" },
        data: { supplierInvoiceNextSeq: { increment: 1 } },
      });

      if (purchaseRequest) {
        // The bill is considered closed the moment it's saved with a cost
        // entered -- no separate "order" vs "received" step. lineTotal
        // (qty x unit cost, tax excluded), not unitCost alone, is what's
        // written back: it's the actual total cost for this line's
        // quantity, matching CustomerInvoiceItem.actualCost's doc comment.
        const actualCost = computedItems[0].lineTotal;
        await tx.customerInvoiceItem.update({
          where: { id: purchaseRequest.customerInvoiceItemId },
          data: { actualCost },
        });
        await tx.purchaseRequest.update({
          where: { id: purchaseRequest.id },
          data: { status: "FULFILLED", cost: actualCost, fulfilledAt: new Date() },
        });
      }

      return { error: null, invoice: created, warning };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This purchase request already has a bill." },
        { status: 409 }
      );
    }
    throw err;
  }

  if (result.error === "pr_not_found") {
    return NextResponse.json({ error: "Purchase request not found." }, { status: 404 });
  }
  if (result.error === "pr_already_fulfilled") {
    return NextResponse.json({ error: "This purchase request already has a bill." }, { status: 409 });
  }
  if (result.error === "pr_supplier_mismatch") {
    return NextResponse.json(
      { error: "Selected supplier doesn't match this purchase request's supplier." },
      { status: 400 }
    );
  }

  const invoice = result.invoice!;

  await writeAuditLog({
    ...actorFromSession(session),
    action: "CREATE",
    entityType: "supplier_invoice",
    entityId: invoice.id,
    entityLabel: `Bill #${invoice.invoiceNumber}`,
    ...extractMeta(request),
  });

  return NextResponse.json({ ...invoice, warning: result.warning ?? null }, { status: 201 });
}
