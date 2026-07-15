import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { nextSequenceNumber } from "@/lib/next-number";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await initializeDatabase();

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
    // Computed via `tx`, not the outer `prisma`, so this aggregate runs
    // inside the same transaction holding the estimate row lock -- see
    // nextSequenceNumber's doc comment for why this is done as a single
    // SQL aggregate rather than a full-table fetch (it directly extends
    // how long every other concurrent conversion has to wait).
    const { nextNumber: invoiceNumber } = await nextSequenceNumber(
      tx,
      "CustomerInvoice",
      "invoiceNumber",
      prefix,
      settingsSeq - 1
    );

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
