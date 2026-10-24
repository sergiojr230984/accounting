import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      customerInvoice: {
        select: {
          invoiceNumber: true,
          customerAddress: true,
          customer: { select: { name: true, phone: true, address: true } },
          items: { select: { id: true, description: true, itemDescription: true, quantity: true } },
        },
      },
      assignedCrewEmployee: { select: { id: true, name: true } },
      photos: { orderBy: { createdAt: "asc" } },
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!delivery) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const base = process.env.APP_URL || new URL(request.url).origin;
  return NextResponse.json({ ...delivery, publicLinkUrl: `${base}/d/${delivery.token}` });
}
