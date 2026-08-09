import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { formatSequenceNumber } from "@/lib/next-number";

const PREFIX = `EST-${new Date().getFullYear()}-`;

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  await initializeDatabase();

  const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  const nextSeq = profile?.estimateNextSeq ?? 1001;

  return NextResponse.json({ nextNumber: formatSequenceNumber(nextSeq, PREFIX) });
}
