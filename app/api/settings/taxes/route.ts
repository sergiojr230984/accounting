import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  rate: z.string().regex(/^\d+(\.\d+)?$/),
  active: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const taxes = await prisma.taxRate.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return NextResponse.json(taxes);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const tax = await prisma.taxRate.create({ data: parsed.data });
  return NextResponse.json(tax, { status: 201 });
}
