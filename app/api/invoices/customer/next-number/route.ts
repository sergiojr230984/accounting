import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  const prefix = profile?.customerInvoicePrefix ?? "INV-2026-";
  const settingsSeq = profile?.customerInvoiceNextSeq ?? 1001;

  // Find the highest numeric suffix among all existing invoice numbers with
  // this prefix, computed as a single aggregate in Postgres instead of
  // fetching every matching invoiceNumber over the wire and looping in JS
  // -- this route runs on every "new invoice" page load, so at a few
  // thousand invoices per prefix that full-table fetch becomes real,
  // recurring latency. substring(... from '^[0-9]+') mirrors parseInt's
  // leading-digit-run behavior exactly (e.g. a manually edited "0003b"
  // suffix still parses as 3), so this is not a behavior change.
  const [{ maxSeq: scannedMax }] = await prisma.$queryRaw<{ maxSeq: number | null }[]>`
    SELECT MAX(CAST(substring(substring("invoiceNumber" from length(${prefix}) + 1) from '^[0-9]+') AS INTEGER)) AS "maxSeq"
    FROM "CustomerInvoice"
    WHERE "invoiceNumber" LIKE ${prefix + "%"}
  `;
  let maxSeq = settingsSeq - 1;
  if (scannedMax !== null && scannedMax > maxSeq) maxSeq = scannedMax;

  const nextSeq = maxSeq + 1;
  const nextNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;

  return NextResponse.json({ nextNumber, prefix, nextSeq });
}
