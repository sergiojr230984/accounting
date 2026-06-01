import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { isAdmin } from "@/lib/crm";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  whatsappNumber: z.string().optional().nullable(),
  whatsappPhoneNumberId: z.string().optional().nullable(),
});

/** PATCH /api/crm/salespeople/[id] — edita una vendedora. Solo ADMIN. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.whatsappNumber !== undefined ? { whatsappNumber: data.whatsappNumber || null } : {}),
      ...(data.whatsappPhoneNumberId !== undefined
        ? { whatsappPhoneNumberId: data.whatsappPhoneNumberId || null }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      whatsappNumber: true,
      whatsappPhoneNumberId: true,
    },
  });

  return NextResponse.json(updated);
}
