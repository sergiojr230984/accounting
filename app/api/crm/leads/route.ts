import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  normalizePhone,
  leadScopeWhere,
  assignLead,
  pickNextSalespersonRoundRobin,
  getCrmSetting,
} from "@/lib/crm";

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  source: z
    .enum(["WHATSAPP", "MANUAL", "REFERRAL", "FACEBOOK", "INSTAGRAM", "WEBSITE", "OTHER"])
    .default("MANUAL"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  status: z.enum(["NEW", "CONTACTED", "FOLLOW_UP", "CLOSED", "LOST"]).optional(),
  assignedToId: z.string().optional().nullable(),
  notes: z.string().optional(),
  nextFollowUpAt: z.string().optional().nullable(),
});

/** GET /api/crm/leads — lista de leads con filtros (limitada por rol). */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const source = searchParams.get("source");
  const assignedToId = searchParams.get("assignedToId");
  const search = searchParams.get("search");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Prisma.LeadWhereInput = {
    // Scope por rol: las vendedoras solo ven sus leads
    ...leadScopeWhere(session),
    ...(status ? { status: status as Prisma.EnumLeadStatusFilter["equals"] } : {}),
    ...(priority ? { priority: priority as Prisma.EnumLeadPriorityFilter["equals"] } : {}),
    ...(source ? { source: source as Prisma.EnumLeadSourceFilter["equals"] } : {}),
    // El filtro por vendedora solo aplica si el admin lo pide
    ...(assignedToId ? { assignedToId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          entryDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const leads = await prisma.lead.findMany({
    where,
    orderBy: [{ entryDate: "desc" }],
    include: {
      assignedTo: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(leads);
}

/** POST /api/crm/leads — crea un lead manualmente desde el panel. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const phone = normalizePhone(data.phone);

  // Anti-duplicados: si el teléfono ya existe, devolvemos el lead existente.
  const existing = await prisma.lead.findUnique({ where: { phone } });
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe un lead con ese teléfono", leadId: existing.id },
      { status: 409 }
    );
  }

  const lead = await prisma.lead.create({
    data: {
      name: data.name,
      phone,
      source: data.source,
      priority: data.priority,
      status: data.status ?? "NEW",
      notes: data.notes || null,
      assignedToId: data.assignedToId || null,
      nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null,
    },
  });

  // Si se asignó manualmente al crear, dejamos registro en el historial.
  if (data.assignedToId) {
    await assignLead(lead.id, data.assignedToId, session.user!.id!, "manual");
  } else {
    // Asignación automática por rotación si está activada
    const setting = await getCrmSetting();
    if (setting.assignmentMode === "ROUND_ROBIN") {
      const next = await pickNextSalespersonRoundRobin();
      if (next) await assignLead(lead.id, next, null, "round_robin");
    }
  }

  const full = await prisma.lead.findUnique({
    where: { id: lead.id },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
  return NextResponse.json(full, { status: 201 });
}
