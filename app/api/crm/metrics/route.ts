import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadScopeWhere } from "@/lib/crm";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/crm/metrics
 * Métricas del CRM: leads por día, leads por vendedora, conteo por estado,
 * tasa de conversión y tiempo promedio de primera respuesta.
 * Respeta el scope por rol (las vendedoras ven solo sus números).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Prisma.LeadWhereInput = {
    ...leadScopeWhere(session),
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
    select: {
      id: true,
      status: true,
      entryDate: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });

  const total = leads.length;

  // ── Conteo por estado ──
  const byStatus = { NEW: 0, CONTACTED: 0, FOLLOW_UP: 0, CLOSED: 0, LOST: 0 };
  for (const l of leads) byStatus[l.status] += 1;

  // ── Tasa de conversión = cerrados / (cerrados + perdidos + activos) ──
  const conversionRate = total > 0 ? byStatus.CLOSED / total : 0;

  // ── Leads por día (últimos 30 días) ──
  const dayMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const l of leads) {
    const key = new Date(l.entryDate).toISOString().slice(0, 10);
    if (dayMap.has(key)) dayMap.set(key, dayMap.get(key)! + 1);
  }
  const leadsByDay = Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }));

  // ── Leads por vendedora ──
  const sellerMap = new Map<string, { name: string; count: number; closed: number }>();
  for (const l of leads) {
    const key = l.assignedTo?.id ?? "unassigned";
    const name = l.assignedTo?.name ?? "Sin asignar";
    const entry = sellerMap.get(key) ?? { name, count: 0, closed: 0 };
    entry.count += 1;
    if (l.status === "CLOSED") entry.closed += 1;
    sellerMap.set(key, entry);
  }
  const leadsBySalesperson = Array.from(sellerMap.values()).sort((a, b) => b.count - a.count);

  // ── Tiempo promedio de primera respuesta ──
  // Para cada lead, tiempo entre el primer mensaje entrante y la primera
  // respuesta saliente. Promediamos en minutos sobre los que sí respondieron.
  const leadIds = leads.map((l) => l.id);
  let avgResponseMinutes: number | null = null;
  if (leadIds.length > 0) {
    const msgs = await prisma.leadMessage.findMany({
      where: { leadId: { in: leadIds } },
      select: { leadId: true, direction: true, timestamp: true },
      orderBy: { timestamp: "asc" },
    });

    const firstInbound = new Map<string, Date>();
    const firstReply = new Map<string, Date>();
    for (const m of msgs) {
      if (m.direction === "INBOUND" && !firstInbound.has(m.leadId)) {
        firstInbound.set(m.leadId, m.timestamp);
      }
      if (m.direction === "OUTBOUND" && firstInbound.has(m.leadId) && !firstReply.has(m.leadId)) {
        // Solo cuenta si la respuesta es posterior al primer entrante
        if (m.timestamp >= firstInbound.get(m.leadId)!) {
          firstReply.set(m.leadId, m.timestamp);
        }
      }
    }

    const diffs: number[] = [];
    for (const [leadId, inbound] of firstInbound.entries()) {
      const reply = firstReply.get(leadId);
      if (reply) diffs.push((reply.getTime() - inbound.getTime()) / 60000);
    }
    if (diffs.length > 0) {
      avgResponseMinutes = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }
  }

  return NextResponse.json({
    total,
    byStatus,
    conversionRate,
    leadsByDay,
    leadsBySalesperson,
    avgResponseMinutes,
  });
}
