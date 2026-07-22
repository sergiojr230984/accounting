import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireAuth, requireRole } from "@/lib/api";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  commissionRate: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  active: z.boolean().default(true),
});

export async function GET() {
  // Any authenticated role can list employees (the invoice-creation "assign
  // to" dropdown needs this for every role), but commissionRate is
  // compensation data -- strip it for anyone who isn't ADMIN/MANAGER.
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  const canSeeCommission = guard.user.role === "ADMIN" || guard.user.role === "MANAGER";

  await initializeDatabase();
  try {
    const employees = await prisma.employee.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { _count: { select: { invoices: true } } },
    });
    if (canSeeCommission) return NextResponse.json(employees);
    const scrubbed = employees.map(({ commissionRate: _commissionRate, ...rest }) => rest);
    return NextResponse.json(scrubbed);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await initializeDatabase();
  try {
    const employee = await prisma.employee.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        commissionRate: parsed.data.commissionRate,
        active: parsed.data.active,
      },
    });
    return NextResponse.json(employee, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
