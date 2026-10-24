import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireReadAccess } from "@/lib/api";

/**
 * Office delivery board (spec §3 "office board"). Deliberately never
 * includes `token` in this bulk response -- only the single-delivery detail
 * route does, which the board links to for the QR/share link. Keeps the
 * list response safe to log/cache without leaking upload links.
 */
export async function GET(request: Request) {
  const access = await requireReadAccess(request, "deliveries");
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const deliveries = await prisma.delivery.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "desc" }],
    include: {
      customerInvoice: { select: { invoiceNumber: true, customerAddress: true, customer: { select: { name: true, address: true } } } },
      assignedCrewEmployee: { select: { name: true } },
      photos: { select: { id: true }, take: 1, orderBy: { createdAt: "asc" } },
      _count: { select: { photos: true } },
    },
  });

  const rows = deliveries.map((d) => ({
    id: d.id,
    status: d.status,
    scheduledDate: d.scheduledDate,
    windowStart: d.windowStart,
    windowEnd: d.windowEnd,
    tokenKind: d.tokenKind,
    invoiceNumber: d.customerInvoice.invoiceNumber,
    customerName: d.customerInvoice.customer.name,
    deliveryAddress: d.customerInvoice.customerAddress ?? d.customerInvoice.customer.address,
    assignedCrewName: d.assignedCrewEmployee?.name ?? null,
    assignedSubcontractorName: d.assignedSubcontractorName,
    subcontractorPayable: d.subcontractorPayable,
    deliveredAt: d.deliveredAt,
    exceptionReason: d.exceptionReason,
    photoCount: d._count.photos,
    firstPhotoId: d.photos[0]?.id ?? null,
  }));

  return NextResponse.json(rows);
}
