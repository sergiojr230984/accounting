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

  // Date inputs send "YYYY-MM-DD". new Date("2026-06-25") parses as UTC
  // midnight, which in any timezone west of UTC (e.g. EST) renders as the
  // PREVIOUS day. Pin to noon UTC so the same calendar date is shown
  // everywhere from UTC-11 to UTC+11.
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
    ? new Date(`${paymentDate}T12:00:00Z`)
    : new Date(paymentDate);

  // The read-then-write here was previously a genuine race: two concurrent
  // payments could both read the same paidAmount, both compute their own
  // "new total" from that stale value, and the second write would clobber
  // the first's contribution (both Payment rows still persisted, but the
  // denormalized total silently disagreed with the ledger). Prisma's
  // client API doesn't expose row locking directly, so this uses an
  // interactive transaction with a raw `SELECT ... FOR UPDATE` to hold a
  // real row lock for the duration of the read-modify-write -- a second
  // concurrent request blocks until the first transaction commits, then
  // sees the now-updated row rather than the stale one.
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string; paidAmount: string; totalAmount: string; downPayment: string }[]
    >`SELECT "id", "paidAmount", "totalAmount", "downPayment" FROM "CustomerInvoice" WHERE "id" = ${id} FOR UPDATE`;
    const invoice = locked[0];
    if (!invoice) return { error: "not_found" as const };

    const newPaidAmount = new Decimal(invoice.paidAmount).plus(new Decimal(amount));
    const total = new Decimal(invoice.totalAmount);
    const down = new Decimal(invoice.downPayment);

    if (newPaidAmount.plus(down).gt(total)) {
      return { error: "overpayment" as const };
    }

    await tx.payment.create({
      data: { amount, paymentDate: parsedDate, notes: notes || null, customerInvoiceId: id },
    });

    const balance = total.minus(newPaidAmount).minus(down);
    let paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" = "UNPAID";
    if (balance.lte(0)) paymentStatus = "PAID";
    else if (newPaidAmount.gt(0)) paymentStatus = "PARTIALLY_PAID";

    await tx.customerInvoice.update({
      where: { id },
      data: { paidAmount: newPaidAmount.toFixed(2), paymentStatus },
    });

    return { error: null };
  });

  if (result.error === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.error === "overpayment") {
    return NextResponse.json(
      { error: "This payment would push paidAmount above the invoice total." },
      { status: 400 }
    );
  }

  const updated = await prisma.customerInvoice.findUnique({
    where: { id },
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
