import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { assignLead, pickNextSalespersonRoundRobin, canManageAll } from "@/lib/crm";

const schema = z.object({
  // toUserId explícito = asignación manual; "auto" = round-robin
  toUserId: z.string().optional(),
  auto: z.boolean().optional(),
});

/**
 * POST /api/crm/leads/[id]/assign
 * Asigna o reasigna un lead a una vendedora. Solo ADMIN/MANAGER.
 * Body: { toUserId } para manual, o { auto: true } para round-robin.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (!canManageAll(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let toUserId = parsed.data.toUserId;
  let reason = "reassign";

  if (parsed.data.auto || !toUserId) {
    const next = await pickNextSalespersonRoundRobin();
    if (!next) {
      return NextResponse.json(
        { error: "No hay vendedoras activas para asignar" },
        { status: 400 }
      );
    }
    toUserId = next;
    reason = "round_robin";
  }

  const updated = await assignLead(id, toUserId, session.user!.id!, reason);
  return NextResponse.json(updated);
}
