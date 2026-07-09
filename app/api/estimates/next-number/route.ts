import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

const PREFIX = `EST-${new Date().getFullYear()}-`;

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const estimates = await prisma.estimate.findMany({
    where: { estimateNumber: { startsWith: PREFIX } },
    select: { estimateNumber: true },
  });

  let maxSeq = 1000;
  for (const est of estimates) {
    const num = parseInt(est.estimateNumber.slice(PREFIX.length), 10);
    if (!isNaN(num) && num > maxSeq) maxSeq = num;
  }

  const nextNumber = `${PREFIX}${String(maxSeq + 1).padStart(4, "0")}`;
  return NextResponse.json({ nextNumber });
}
