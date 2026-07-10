import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  commissionRate: z.string().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !isAdmin(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const employee = await prisma.employee.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(employee);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002")
      return NextResponse.json({ error: "Email already in use by another employee" }, { status: 409 });
    if ((e as { code?: string }).code === "P2025")
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    throw e;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !isAdmin(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.employee.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
