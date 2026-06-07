import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  rate: z.string().regex(/^\d+(\.\d+)?$/),
  active: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await initializeDatabase();
  try {
    const taxes = await prisma.taxRate.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
    return NextResponse.json(taxes);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await initializeDatabase();
  const tax = await prisma.taxRate.create({ data: parsed.data });
  return NextResponse.json(tax, { status: 201 });
}
