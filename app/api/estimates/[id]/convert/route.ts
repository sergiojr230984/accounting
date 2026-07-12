import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // The check-then-act on convertedInvoiceId was a genuine race: two
  // concurrent conversion requests could both pass the null check before
  // either wrote convertedInvoiceId, and both create a real invoice --
  // double-booking revenue from a single estimate (live-reproduced in an
  // earlier audit with 8 concurrent requests). A raw SELECT ... FOR UPDATE
  // acquires a real row lock for the duration of the transaction; a second
  // concurrent request blocks on that same lock until the first commits,
  // then sees convertedInvoiceId already set and correctly 409s instead of
  // also converting.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Estimate" WHERE "id" = ${id} FOR UPDATE`;
    const estimate = await tx.estimate.findUnique({ where: { id }, include: { items: true } });
    if (!estimate) return { error: "not_found" as const };
    if (estimate.convertedInvoiceId) return { error: "already_converted" as const };

    const profile = await tx.companyProfile.findUnique({ where: { id: "default" } });
    const prefix = profile?.customerInvoicePrefix ?? "INV-2026-";
    const settingsSeq = profile?.customerInvoiceNextSeq ?? 1001;
    const existingInvoices = await tx.customerInvoice.findMany({
      where: { invoiceNumber: { startsWith: prefix } },
      select: { invoiceNumber: true },
    });
    let maxSeq = settingsSeq - 1;
    for (const inv of existingInvoices) {
      const num = parseInt(inv.invoiceNumber.slice(prefix.length), 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
    const invoiceNumber = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;

    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await tx.customerInvoice.create({
      data: {
        customerId: estimate.customerId,
        invoiceNumber,
        invoiceDate: today,
        dueDate,
        subtotal: estimate.subtotal,
        taxAmount: estimate.taxAmount,
        totalAmount: estimate.totalAmount,
        notes: estimate.notes,
        items: {
          create: estimate.items.map((item) => ({
            description: item.description,
            itemDescription: item.itemDescription,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            lineTotal: item.lineTotal,
          })),
        },
      },
    });

    await tx.estimate.update({
      where: { id },
      data: { status: "ACCEPTED", convertedInvoiceId: invoice.id },
    });

    return { error: null, invoiceId: invoice.id };
  });

  if (result.error === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.error === "already_converted") {
    return NextResponse.json({ error: "This estimate was already converted to an invoice" }, { status: 409 });
  }

  return NextResponse.json({ invoiceId: result.invoiceId });
}
