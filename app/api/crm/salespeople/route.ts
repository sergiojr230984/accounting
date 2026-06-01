import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { isAdmin } from "@/lib/crm";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  whatsappNumber: z.string().optional(),
  whatsappPhoneNumberId: z.string().optional(),
});

/**
 * GET /api/crm/salespeople
 * Lista las vendedoras (usuarios con rol SALES) con su carga de leads.
 * Cualquier usuario autenticado puede leerla (para poblar selects de asignación).
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salespeople = await prisma.user.findMany({
    where: { role: "SALES" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      whatsappNumber: true,
      whatsappPhoneNumberId: true,
      _count: { select: { assignedLeads: true } },
    },
  });

  return NextResponse.json(salespeople);
}

/**
 * POST /api/crm/salespeople
 * Crea una vendedora (usuario con rol SALES). Solo ADMIN.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: await bcrypt.hash(data.password, 12),
      role: "SALES",
      whatsappNumber: data.whatsappNumber || null,
      whatsappPhoneNumberId: data.whatsappPhoneNumberId || null,
    },
    select: { id: true, name: true, email: true, active: true, whatsappNumber: true },
  });

  return NextResponse.json(user, { status: 201 });
}
