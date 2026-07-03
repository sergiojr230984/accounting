import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  const prefix = profile?.customerInvoicePrefix ?? "INV-2026-";
  const settingsSeq = profile?.customerInvoiceNextSeq ?? 1001;

  // Find the highest numeric suffix among all existing invoice numbers with this prefix
  const invoices = await prisma.customerInvoice.findMany({
    where: { invoiceNumber: { startsWith: prefix } },
    select: { invoiceNumber: true },
  });

  let maxSeq = settingsSeq - 1;
  for (const inv of invoices) {
    const suffix = inv.invoiceNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!isNaN(num) && num > maxSeq) maxSeq = num;
  }

  const nextSeq = maxSeq + 1;
  const nextNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;

  return NextResponse.json({ nextNumber, prefix, nextSeq });
}
