import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import Decimal from "decimal.js";

const itemSchema = z.object({
  description: z.string().min(1),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  taxRate: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Must be a number")
    .default("0")
    .refine((v) => Number(v) < 10, "Tax rate must be a fraction between 0 and 10 (e.g. 0.08 for 8%)"),
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
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { customerId, invoiceNumber, invoiceDate, dueDate, items, notes, paymentStatus, paidAmount } =
    parsed.data;

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

  const computedItems = items.map((item) => {
    const qty = new Decimal(item.quantity);
    const price = new Decimal(item.unitPrice);
    const rate = new Decimal(item.taxRate);
    const lineTotal = qty.times(price);
    const lineTax = lineTotal.times(rate);
    subtotal = subtotal.plus(lineTotal);
    taxAmount = taxAmount.plus(lineTax);
    return { ...item, lineTotal: lineTotal.toFixed(2) };
  });

  const totalAmount = subtotal.plus(taxAmount);

  const invoice = await prisma.customerInvoice.create({
    data: {
      customerId,
      invoiceNumber,
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      paidAmount: paidAmount ?? "0",
      paymentStatus: paymentStatus ?? "UNPAID",
      notes,
      items: {
        create: computedItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
        })),
      },
    },
    include: { customer: true, items: true },
  });

  return NextResponse.json(invoice, { status: 201 });
}
