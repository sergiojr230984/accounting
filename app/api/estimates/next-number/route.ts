import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { nextSequenceNumber } from "@/lib/next-number";

const PREFIX = `EST-${new Date().getFullYear()}-`;

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  await initializeDatabase();

  const { nextNumber } = await nextSequenceNumber(prisma, "Estimate", "estimateNumber", PREFIX, 1000);
  return NextResponse.json({ nextNumber });
}
