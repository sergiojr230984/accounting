import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireAuth } from "@/lib/api";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  incomeAccount: z.string().optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  await initializeDatabase();
  try {
    const products = await prisma.product.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return NextResponse.json(products);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireAuth();
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
    const product = await prisma.product.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        price: parsed.data.price,
        taxRate: parsed.data.taxRate,
        incomeAccount: parsed.data.incomeAccount || null,
        active: parsed.data.active,
      },
    });
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
