import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog, extractMeta, actorFromSession, diffChanges } from "@/lib/audit";
import { z } from "zod";
import Decimal from "decimal.js";

const paymentSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  paymentDate: z.string(),
  notes: z.string().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, paymentId } = await params;

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.customerInvoiceId !== id) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  const invoice = await prisma.customerInvoice.findUnique({
    where: { id },
    include: { payments: true },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

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

  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
    ? new Date(`${paymentDate}T12:00:00Z`)
    : new Date(paymentDate);

  await prisma.payment.update({
    where: { id: paymentId },
    data: { amount, paymentDate: parsedDate, notes: notes || null },
  });

  // Recompute paidAmount from all payments (other payments + updated amount)
  const otherPayments = invoice.payments.filter((p) => p.id !== paymentId);
  const newPaidAmount = otherPayments.reduce(
    (sum, p) => sum.plus(new Decimal(p.amount.toString())),
    new Decimal(0)
  ).plus(new Decimal(amount));

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
    data: { paidAmount: newPaidAmount.toFixed(2), paymentStatus },
    include: {
      customer: true,
      items: true,
      payments: { orderBy: { paymentDate: "desc" } },
      files: true,
      employee: { select: { id: true, name: true } },
    },
  });

  await writeAuditLog({
    ...actorFromSession(session),
    action: "UPDATE",
    entityType: "payment",
    entityId: paymentId,
    entityLabel: `Payment on Invoice #${updated.invoiceNumber}`,
    changes: diffChanges(
      { amount: payment.amount.toString(), paymentDate: payment.paymentDate.toISOString(), notes: payment.notes },
      { amount, paymentDate: parsedDate.toISOString(), notes: notes || null }
    ),
    ...extractMeta(request),
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, paymentId } = await params;

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.customerInvoiceId !== id) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  const invoice = await prisma.customerInvoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  await prisma.payment.delete({ where: { id: paymentId } });

  const newPaidAmount = Decimal.max(
    new Decimal(invoice.paidAmount.toString()).minus(new Decimal(payment.amount.toString())),
    new Decimal(0)
  );
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
    data: { paidAmount: newPaidAmount.toFixed(2), paymentStatus },
    include: {
      customer: true,
      items: true,
      payments: { orderBy: { paymentDate: "desc" } },
      files: true,
      employee: { select: { id: true, name: true } },
    },
  });

  await writeAuditLog({
    ...actorFromSession(session),
    action: "DELETE",
    entityType: "payment",
    entityId: paymentId,
    entityLabel: `Payment of $${payment.amount.toString()} on Invoice #${updated.invoiceNumber}`,
    ...extractMeta(request),
  });

  return NextResponse.json(updated);
}
