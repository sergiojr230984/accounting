import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")).or(z.null()),
  phone: z.string().optional().or(z.null()),
  commissionRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  active: z.boolean().optional(),
});

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

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone || null;
  if (parsed.data.commissionRate !== undefined) data.commissionRate = parsed.data.commissionRate;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;

  const employee = await prisma.employee.update({ where: { id }, data });
  return NextResponse.json(employee);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const linked = await prisma.customerInvoice.count({ where: { employeeId: id } });
  if (linked > 0) {
    return NextResponse.json(
      { error: `Cannot delete — this employee is linked to ${linked} invoice(s). Deactivate them instead.` },
      { status: 409 }
    );
  }
  await prisma.employee.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
