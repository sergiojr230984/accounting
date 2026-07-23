import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { nextSequenceNumber } from "@/lib/next-number";

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  const prefix = profile?.customerInvoicePrefix ?? "INV-2026-";
  const settingsSeq = profile?.customerInvoiceNextSeq ?? 1001;

  const { nextNumber, nextSeq } = await nextSequenceNumber(
    prisma,
    "CustomerInvoice",
    "invoiceNumber",
    prefix,
    settingsSeq - 1
  );

  return NextResponse.json({ nextNumber, prefix, nextSeq });
}
