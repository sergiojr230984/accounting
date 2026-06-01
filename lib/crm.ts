/**
 * Lógica de negocio del CRM: normalización de teléfonos, permisos por rol,
 * y asignación de leads (manual y round-robin).
 */
import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";

/** Normaliza un teléfono a formato E.164 simple: "+" + solo dígitos. */
export function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

// ── Permisos por rol ────────────────────────────────────────────────────────

/** ADMIN y MANAGER ven y administran todos los leads. SALES solo los suyos. */
export function canManageAll(role?: string | null): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function isAdmin(role?: string | null): boolean {
  return role === "ADMIN";
}

/**
 * Devuelve el filtro Prisma `where` para limitar los leads según el rol del
 * usuario: las vendedoras (SALES) solo ven los leads asignados a ellas.
 */
export function leadScopeWhere(session: Session | null): { assignedToId?: string } {
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (canManageAll(role)) return {};
  return { assignedToId: session?.user?.id };
}

// ── Asignación de leads ──────────────────────────────────────────────────────

/**
 * Asigna (o reasigna) un lead a una vendedora y registra el cambio en el
 * historial de asignaciones. Todo en una transacción para mantener consistencia.
 *
 * @param leadId       lead a asignar
 * @param toUserId     vendedora destino
 * @param changedById  quién hace el cambio (null = sistema/round-robin)
 * @param reason       etiqueta del motivo ("manual", "round_robin", "reassign")
 */
export async function assignLead(
  leadId: string,
  toUserId: string,
  changedById: string | null,
  reason: string
) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { assignedTo: true },
  });
  if (!lead) throw new Error("Lead no encontrado");

  // Si ya estaba asignado a esa misma vendedora, no hacemos nada.
  if (lead.assignedToId === toUserId) return lead;

  const [updated] = await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { assignedToId: toUserId },
      include: { assignedTo: true },
    }),
    prisma.leadAssignment.create({
      data: {
        leadId,
        fromUserName: lead.assignedTo?.name ?? null,
        toUserId,
        changedById,
        reason,
      },
    }),
  ]);

  return updated;
}

/**
 * Selecciona la siguiente vendedora activa según round-robin, usando el
 * puntero guardado en CrmSetting. Devuelve su id, o null si no hay vendedoras.
 */
export async function pickNextSalespersonRoundRobin(): Promise<string | null> {
  const salespeople = await prisma.user.findMany({
    where: { role: "SALES", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (salespeople.length === 0) return null;

  const setting = await prisma.crmSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  const index = setting.lastRotationIndex % salespeople.length;
  const chosen = salespeople[index];

  await prisma.crmSetting.update({
    where: { id: "singleton" },
    data: { lastRotationIndex: (index + 1) % salespeople.length },
  });

  return chosen.id;
}

/** Lee la configuración del CRM, creándola con defaults si no existe. */
export async function getCrmSetting() {
  return prisma.crmSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}
