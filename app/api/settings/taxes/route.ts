import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireAuth, requireRole } from "@/lib/api";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  rate: z.string().regex(/^\d+(\.\d+)?$/),
  active: z.boolean().default(true),
});

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  await initializeDatabase();
  try {
    const taxes = await prisma.taxRate.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
    return NextResponse.json(taxes, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await initializeDatabase();
  const tax = await prisma.taxRate.create({ data: parsed.data });
  return NextResponse.json(tax, { status: 201 });
}
