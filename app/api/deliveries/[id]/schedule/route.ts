import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";
import { actorFromSession } from "@/lib/audit";
import { scheduleDelivery } from "@/lib/deliveries";

const schema = z
  .object({
    windowStart: z.string().datetime().or(z.string().min(1)),
    windowEnd: z.string().datetime().or(z.string().min(1)),
    assignedCrewEmployeeId: z.string().optional().nullable(),
    assignedSubcontractorName: z.string().optional().nullable(),
    subcontractorCost: z.string().regex(/^\d+(\.\d+)?$/).optional().nullable(),
  })
  .refine((d) => !!d.assignedCrewEmployeeId || !!d.assignedSubcontractorName, {
    message: "Assign either an in-house crew member or a subcontractor.",
  });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const windowStart = new Date(parsed.data.windowStart);
  const windowEnd = new Date(parsed.data.windowEnd);
  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
    return NextResponse.json({ error: "Invalid delivery window." }, { status: 400 });
  }

  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: { customerInvoice: { select: { invoiceNumber: true, customerAddress: true, customer: { select: { name: true, address: true } } } } },
  });
  if (!delivery) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.assignedCrewEmployeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: parsed.data.assignedCrewEmployeeId } });
    if (!emp || !emp.active) {
      return NextResponse.json({ error: "Selected crew member is not an active employee." }, { status: 400 });
    }
  }

  const base = process.env.APP_URL || new URL(request.url).origin;
  const actor = actorFromSession(guard);

  try {
    const updated = await scheduleDelivery(id, {
      windowStart,
      windowEnd,
      assignedCrewEmployeeId: parsed.data.assignedCrewEmployeeId ?? null,
      assignedSubcontractorName: parsed.data.assignedSubcontractorName ?? null,
      subcontractorCost: parsed.data.subcontractorCost ?? null,
      invoiceNumber: delivery.customerInvoice.invoiceNumber,
      customerFirstName: delivery.customerInvoice.customer.name.split(" ")[0] || delivery.customerInvoice.customer.name,
      deliveryAddress: delivery.customerInvoice.customerAddress ?? delivery.customerInvoice.customer.address ?? "",
      publicLinkUrl: `${base}/d/${delivery.token}`,
      timeZone: process.env.DELIVERY_TIMEZONE || "America/New_York",
      actorLabel: actor.actorName,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
