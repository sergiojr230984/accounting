import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Single-purchase-request lookup, used to prefill the "Create Bill" flow
 * (app/(dashboard)/invoices/supplier/new/page.tsx?purchaseRequestId=...)
 * from the Purchasing queue / Items Ordered report. Read-only, session-auth
 * only (not exposed to API keys -- this is an internal operational detail,
 * not report data).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      customerInvoice: { select: { id: true, invoiceNumber: true } },
    },
  });
  if (!pr) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(pr);
}
