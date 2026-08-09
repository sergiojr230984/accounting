import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireRole, requireReadAccess } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  incomeAccount: z.string().optional(),
  active: z.boolean().default(true),
});

export async function GET(request: Request) {
  const access = await requireReadAccess(request, "products");
  if (access instanceof NextResponse) return access;

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
  // Only Admin can add to the catalog -- this is what keeps staff from
  // spawning near-duplicate products/services (e.g. five slightly
  // different "Delivery" line items) that fragment the frequency report.
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
    const name = parsed.data.name.trim();
    const dup = await prisma.product.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (dup) {
      return NextResponse.json(
        {
          error: `A product/service named "${dup.name}" already exists${dup.active ? "" : " (currently inactive)"}. Edit or reactivate it instead of creating a duplicate.`,
        },
        { status: 409 }
      );
    }

    const product = await prisma.product.create({
      data: {
        name,
        description: parsed.data.description || null,
        price: parsed.data.price,
        taxRate: parsed.data.taxRate,
        incomeAccount: parsed.data.incomeAccount || null,
        active: parsed.data.active,
      },
    });

    await writeAuditLog({
      ...actorFromSession(guard),
      action: "CREATE",
      entityType: "product",
      entityId: product.id,
      entityLabel: product.name,
      ...extractMeta(request),
    });

    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
