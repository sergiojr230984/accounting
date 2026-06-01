import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canManageAll } from "@/lib/crm";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["NEW", "CONTACTED", "FOLLOW_UP", "CLOSED", "LOST"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  source: z
    .enum(["WHATSAPP", "MANUAL", "REFERRAL", "FACEBOOK", "INSTAGRAM", "WEBSITE", "OTHER"])
    .optional(),
  notes: z.string().optional().nullable(),
  nextFollowUpAt: z.string().optional().nullable(),
});

/** GET /api/crm/leads/[id] — detalle del lead con historial y mensajes. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, name: true, whatsappNumber: true } },
      messages: { orderBy: { timestamp: "asc" } },
      assignments: {
        orderBy: { createdAt: "desc" },
        include: {
          toUser: { select: { name: true } },
          changedBy: { select: { name: true } },
        },
      },
    },
  });

  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Una vendedora solo puede ver sus propios leads
  const role = (session.user as { role?: string }).role;
  if (!canManageAll(role) && lead.assignedToId !== session.user!.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(lead);
}

/** PATCH /api/crm/leads/[id] — actualiza estado, prioridad, notas, seguimiento. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Las vendedoras solo pueden editar sus propios leads
  const role = (session.user as { role?: string }).role;
  if (!canManageAll(role) && existing.assignedToId !== session.user!.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = parsed.data;
  const updated = await prisma.lead.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.source !== undefined ? { source: data.source } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.nextFollowUpAt !== undefined
        ? { nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null }
        : {}),
    },
    include: { assignedTo: { select: { id: true, name: true } } },
  });

  return NextResponse.json(updated);
}
