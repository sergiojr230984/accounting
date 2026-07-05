import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year = new Date().getFullYear();

  const result = await prisma.$queryRaw<{ max_seq: number | null }[]>`
    SELECT MAX(
      CAST(SPLIT_PART("invoiceNumber", '-', 3) AS INTEGER)
    ) AS max_seq
    FROM "CustomerInvoice"
    WHERE "invoiceNumber" ~ '^INV-[0-9]{4}-[0-9]+$'
  `;

  const maxSeq = Number(result[0]?.max_seq ?? 0);
  return NextResponse.json({ nextNumber: `INV-${year}-${maxSeq + 1}` });
}
