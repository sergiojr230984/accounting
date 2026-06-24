import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Decimal from "decimal.js";

export async function DELETE(
  _request: Request,
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

  return NextResponse.json(updated);
}
