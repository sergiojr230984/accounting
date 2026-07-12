import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";

const PREFIX = `EST-${new Date().getFullYear()}-`;

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  await initializeDatabase();

  // Aggregate in Postgres instead of fetching every matching
  // estimateNumber and looping in JS -- same fix as the customer-invoice
  // equivalent of this route.
  const [{ maxSeq: scannedMax }] = await prisma.$queryRaw<{ maxSeq: number | null }[]>`
    SELECT MAX(CAST(substring(substring("estimateNumber" from length(${PREFIX}) + 1) from '^[0-9]+') AS INTEGER)) AS "maxSeq"
    FROM "Estimate"
    WHERE "estimateNumber" LIKE ${PREFIX + "%"}
  `;
  const maxSeq = scannedMax !== null && scannedMax > 1000 ? scannedMax : 1000;

  const nextNumber = `${PREFIX}${String(maxSeq + 1).padStart(4, "0")}`;
  return NextResponse.json({ nextNumber });
}
