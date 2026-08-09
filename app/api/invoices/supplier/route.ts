import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireReadAccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { computeLineTotals } from "@/lib/money";
import { z } from "zod";

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

  const { supplierId, invoiceNumber, invoiceDate, dueDate, category, items, notes, paymentStatus, paidAmount, customerInvoiceRef } =
    parsed.data;

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

  const invoice = await prisma.supplierInvoice.create({
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
      customerInvoiceRef: customerInvoiceRef || null,
      items: {
        create: computedItems.map((item) => ({
          description: item.description,
          itemDescription: item.itemDescription ?? null,
          quantity: item.quantity,
          unitCost: item.unitCost,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
        })),
      },
    },
    // Narrowed select -- the create response's supplier field is unused by
    // the client (it just reads the new bill's id and redirects), so bank
    // account/routing/Zelle details have no reason to be in this response
    // at all, let alone unscoped by role.
    include: { supplier: { select: { id: true, name: true } }, items: true },
  });

  await prisma.companyProfile
    .update({
      where: { id: "default" },
      data: { supplierInvoiceNextSeq: { increment: 1 } },
    })
    .catch(() => undefined);

  await writeAuditLog({
    ...actorFromSession(session),
    action: "CREATE",
    entityType: "supplier_invoice",
    entityId: invoice.id,
    entityLabel: `Bill #${invoice.invoiceNumber}`,
    ...extractMeta(request),
  });

  return NextResponse.json(invoice, { status: 201 });
}
