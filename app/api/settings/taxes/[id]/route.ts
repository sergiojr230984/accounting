import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  rate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const tax = await prisma.taxRate.update({ where: { id }, data: parsed.data });
  return NextResponse.json(tax);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await prisma.taxRate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
