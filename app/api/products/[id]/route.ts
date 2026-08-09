import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession, diffChanges } from "@/lib/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  taxRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  incomeAccount: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const d = parsed.data;
  const newName = d.name?.trim();
  try {
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (newName) {
      const dup = await prisma.product.findFirst({
        where: { name: { equals: newName, mode: "insensitive" }, NOT: { id } },
      });
      if (dup) {
        return NextResponse.json(
          { error: `A product/service named "${dup.name}" already exists.` },
          { status: 409 }
        );
      }
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(newName !== undefined && { name: newName }),
        ...(d.description !== undefined && { description: d.description || null }),
        ...(d.price !== undefined && { price: d.price }),
        ...(d.taxRate !== undefined && { taxRate: d.taxRate }),
        ...(d.incomeAccount !== undefined && { incomeAccount: d.incomeAccount }),
        ...(d.active !== undefined && { active: d.active }),
      },
    });

    await writeAuditLog({
      ...actorFromSession(guard),
      action: "UPDATE",
      entityType: "product",
      entityId: id,
      entityLabel: product.name,
      changes: diffChanges(
        {
          name: existing.name,
          price: existing.price.toString(),
          taxRate: existing.taxRate.toString(),
          active: existing.active,
        },
        {
          name: product.name,
          price: product.price.toString(),
          taxRate: product.taxRate.toString(),
          active: product.active,
        }
      ),
      ...extractMeta(request),
    });

    return NextResponse.json(product);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Deliberately no DELETE handler -- a catalog item can be created or locked
// (active: false) via PATCH above, but never permanently removed. Products
// are referenced by name from historical invoices (there's no foreign key),
// so deleting one would silently orphan the frequency report's grouping for
// every past invoice that used it.
