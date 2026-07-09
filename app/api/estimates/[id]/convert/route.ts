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
  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!estimate) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (estimate.convertedInvoiceId) {
    return NextResponse.json({ error: "This estimate was already converted to an invoice" }, { status: 409 });
  }

  const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  const prefix = profile?.customerInvoicePrefix ?? "INV-2026-";
  const settingsSeq = profile?.customerInvoiceNextSeq ?? 1001;
  const existingInvoices = await prisma.customerInvoice.findMany({
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

  const invoice = await prisma.customerInvoice.create({
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

  await prisma.estimate.update({
    where: { id },
    data: { status: "ACCEPTED", convertedInvoiceId: invoice.id },
  });

  return NextResponse.json({ invoiceId: invoice.id });
}
