import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { formatSequenceNumber } from "@/lib/next-number";

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  // `||`, not `??` -- an empty string (a blanked-out Settings field, saved
  // as "" rather than left unset) must fall back to the default too.
  const prefix = profile?.customerInvoicePrefix || "INV-2026-";
  const nextSeq = profile?.customerInvoiceNextSeq ?? 1001;

  return NextResponse.json({ nextNumber: formatSequenceNumber(nextSeq, prefix), prefix, nextSeq });
}
