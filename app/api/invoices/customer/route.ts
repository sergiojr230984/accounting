import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    employeeId,
    commissionRate,
    addCreditCardFee,
    appliedFees,
  } = parsed.data;

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

  let creditCardFee = new Decimal(0);
  if (addCreditCardFee) {
    const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
    if (profile && Number(profile.creditCardFeeRate) > 0) {
      creditCardFee = subtotal.plus(taxAmount).times(profile.creditCardFeeRate.toString());
    }
  }

  let customFeesSum = new Decimal(0);
  for (const f of appliedFees) {
    try {
      customFeesSum = customFeesSum.plus(new Decimal(f.amount));
    } catch {
      // skip malformed entry
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
