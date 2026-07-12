import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import Decimal from "decimal.js";

const paymentSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  paymentDate: z.string(),
  notes: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const invoice = await prisma.customerInvoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { amount, paymentDate, notes } = parsed.data;

  const prospectivePaid = new Decimal(invoice.paidAmount.toString()).plus(new Decimal(amount));
  const invoiceTotal = new Decimal(invoice.totalAmount.toString());
  const invoiceDown = new Decimal(invoice.downPayment.toString());
  if (prospectivePaid.plus(invoiceDown).gt(invoiceTotal)) {
    return NextResponse.json(
      { error: "This payment would push paidAmount above the invoice total." },
      { status: 400 }
    );
  }

  // Date inputs send "YYYY-MM-DD". new Date("2026-06-25") parses as UTC
  // midnight, which in any timezone west of UTC (e.g. EST) renders as the
  // PREVIOUS day. Pin to noon UTC so the same calendar date is shown
  // everywhere from UTC-11 to UTC+11.
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
    ? new Date(`${paymentDate}T12:00:00Z`)
    : new Date(paymentDate);

  await prisma.payment.create({
    data: {
      amount,
      paymentDate: parsedDate,
      notes: notes || null,
      customerInvoiceId: id,
    },
  });

  const newPaidAmount = new Decimal(invoice.paidAmount.toString()).plus(new Decimal(amount));
  const total = new Decimal(invoice.totalAmount.toString());
  const down = new Decimal(invoice.downPayment.toString());
  const balance = total.minus(newPaidAmount).minus(down);

  let paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" = "UNPAID";
  if (balance.lte(0)) {
    paymentStatus = "PAID";
  } else if (newPaidAmount.gt(0)) {
    paymentStatus = "PARTIALLY_PAID";
  }

  const updated = await prisma.customerInvoice.update({
    where: { id },
    data: {
      paidAmount: newPaidAmount.toFixed(2),
      paymentStatus,
    },
    include: {
      customer: true,
      items: true,
      payments: { orderBy: { paymentDate: "desc" } },
      files: true,
      employee: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(updated, { status: 201 });
}
