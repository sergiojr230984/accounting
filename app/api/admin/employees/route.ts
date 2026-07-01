import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  if (!session || !isAdmin(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });

  return NextResponse.json(employees);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session || !isAdmin(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    commissionRate: z.string().default("0"),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const employee = await prisma.employee.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        commissionRate: parsed.data.commissionRate,
        active: true,
      },
    });
    return NextResponse.json(employee, { status: 201 });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002")
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    throw e;
  }
}
