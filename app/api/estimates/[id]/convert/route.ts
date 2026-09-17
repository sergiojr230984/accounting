import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { formatSequenceNumber, claimSequenceNumber } from "@/lib/next-number";

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
  let result: { error: "not_found" | "already_converted" | null; invoiceId?: string };
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Estimate" WHERE "id" = ${id} FOR UPDATE`;
      const estimate = await tx.estimate.findUnique({ where: { id }, include: { items: true } });
      if (!estimate) return { error: "not_found" as const };
      if (estimate.convertedInvoiceId) return { error: "already_converted" as const };

      const profile = await tx.companyProfile.findUnique({ where: { id: "default" } });
      // `||`, not `??` -- see the matching comment in
      // app/api/invoices/customer/next-number/route.ts.
      const prefix = profile?.customerInvoicePrefix || "INV-2026-";
      const nextSeq = profile?.customerInvoiceNextSeq ?? 1001;
      const invoiceNumber = formatSequenceNumber(nextSeq, prefix);

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
          appliedFees: estimate.appliedFees as unknown as object,
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

      // Same transaction as the invoice's creation -- see claimSequenceNumber's
      // doc comment in lib/next-number.ts for why this (not a MAX-scan or a
      // fire-and-forget increment) is what guarantees this number is never
      // reissued, even if this invoice is later deleted.
      await claimSequenceNumber(tx, "customerInvoiceNextSeq", invoiceNumber, prefix);

      return { error: null, invoiceId: invoice.id };
    });
  } catch (err) {
    // invoiceNumber here is peeked from CompanyProfile.customerInvoiceNextSeq
    // without a row lock on it, so this can race a concurrent conversion (or
    // a concurrent customer-invoice creation/edit) computing the exact same
    // number -- the DB's own unique constraint on invoiceNumber (see
    // prisma/schema.prisma) is the real guard, and it rejects the loser with
    // a P2002 error. Without this catch that surfaced as an unhandled 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "That invoice number was just claimed by another request. Please try converting again." },
        { status: 409 }
      );
    }
    throw err;
  }

  if (result.error === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.error === "already_converted") {
    return NextResponse.json({ error: "This estimate was already converted to an invoice" }, { status: 409 });
  }

  return NextResponse.json({ invoiceId: result.invoiceId });
}
