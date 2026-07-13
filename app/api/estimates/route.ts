import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { z } from "zod";
import Decimal from "decimal.js";

const itemSchema = z.object({
  description: z.string().min(1),
  itemDescription: z.string().optional(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number").default("0"),
});

const estimateSchema = z.object({
  customerId: z.string().min(1),
  estimateNumber: z.string().min(1),
  estimateDate: z.string(),
  expiryDate: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
  notes: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initializeDatabase();

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;

  const [estimates, total] = await Promise.all([
    prisma.estimate.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        items: true,
      },
      orderBy: { estimateDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.estimate.count({ where }),
  ]);

  return NextResponse.json({ estimates, total, page, limit });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initializeDatabase();

  const body = await request.json();
  const parsed = estimateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { customerId, estimateNumber, estimateDate, expiryDate, items, notes } = parsed.data;

  // customerId is a foreign key the DB will reject with a raw constraint-
  // violation error if it references a row that doesn't exist -- checked
  // here so that's a clean 404 instead of an unhandled 500.
  const customerExists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customerExists) {
    return NextResponse.json({ error: "Selected customer no longer exists." }, { status: 404 });
  }

  const existing = await prisma.estimate.findUnique({
    where: { estimateNumber_customerId: { estimateNumber, customerId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Estimate number already exists for this customer" },
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

  const estimate = await prisma.estimate.create({
    data: {
      customerId,
      estimateNumber,
      estimateDate: new Date(estimateDate),
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
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

  return NextResponse.json(estimate, { status: 201 });
}
