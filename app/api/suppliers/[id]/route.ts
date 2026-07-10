import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { writeAuditLog, extractMeta, actorFromSession, diffChanges } from "@/lib/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")).or(z.null()),
  phone: z.string().optional().or(z.null()),
  address: z.string().optional().or(z.null()),
  // 1099 contractor fields
  is1099Contractor: z.boolean().optional(),
  taxIdType: z.enum(["SSN", "EIN"]).optional().nullable(),
  legalName: z.string().optional().nullable(),
  businessAddress: z.string().optional().nullable(),
  w9OnFile: z.boolean().optional(),
  default1099Box: z.string().optional().nullable(),
});

const tinUpdateSchema = z.object({
  taxId: z.string().min(1),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = requirePermission(session, "supplier", "update");
  if (!allowed) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "supplier", entityLabel: "Update Supplier", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  // TIN updates are Admin-only
  if ("taxId" in body) {
    const { allowed: tinAllowed } = requirePermission(session, "contractor_tin", "update");
    if (!tinAllowed) {
      await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "contractor_tin", entityLabel: `Supplier ${id} TIN`, ...extractMeta(request) });
      return NextResponse.json({ error: "Forbidden: TIN access is Admin-only" }, { status: 403 });
    }

    const tinParsed = tinUpdateSchema.safeParse({ taxId: body.taxId });
    if (!tinParsed.success) return NextResponse.json({ error: "Invalid TIN" }, { status: 400 });

    const { encryptTin } = await import("@/lib/tin-crypto");
    const encryptedTin = encryptTin(tinParsed.data.taxId);

    const updated = await prisma.supplier.update({
      where: { id },
      data: { taxId: encryptedTin },
    });

    await writeAuditLog({
      ...actorFromSession(session),
      action: "UPDATE",
      entityType: "contractor_tin",
      entityId: id,
      entityLabel: `${updated.name} TIN`,
      ...extractMeta(request),
    });

    return NextResponse.json({ ok: true });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const beforeSnapshot = {
    name: existing.name,
    email: existing.email,
    phone: existing.phone,
    address: existing.address,
    is1099Contractor: existing.is1099Contractor,
  };

  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      ...(parsed.data.is1099Contractor !== undefined && { is1099Contractor: parsed.data.is1099Contractor }),
      ...(parsed.data.taxIdType !== undefined && { taxIdType: parsed.data.taxIdType }),
      ...(parsed.data.legalName !== undefined && { legalName: parsed.data.legalName }),
      ...(parsed.data.businessAddress !== undefined && { businessAddress: parsed.data.businessAddress }),
      ...(parsed.data.w9OnFile !== undefined && { w9OnFile: parsed.data.w9OnFile }),
      ...(parsed.data.default1099Box !== undefined && { default1099Box: parsed.data.default1099Box }),
    },
  });

  await writeAuditLog({
    ...actorFromSession(session),
    action: "UPDATE",
    entityType: "supplier",
    entityId: id,
    entityLabel: supplier.name,
    changes: diffChanges(beforeSnapshot, {
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      is1099Contractor: supplier.is1099Contractor,
    }),
    ...extractMeta(request),
  });

  return NextResponse.json(supplier);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = requirePermission(session, "supplier", "delete");
  if (!allowed) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "supplier", entityLabel: "Delete Supplier", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const invoiceCount = await prisma.supplierInvoice.count({ where: { supplierId: id } });
  if (invoiceCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete — this supplier has ${invoiceCount} invoice(s). Delete their invoices first.` },
      { status: 409 }
    );
  }

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.supplier.delete({ where: { id } });

  await writeAuditLog({
    ...actorFromSession(session),
    action: "DELETE",
    entityType: "supplier",
    entityId: id,
    entityLabel: existing.name,
    ...extractMeta(request),
  });

  return NextResponse.json({ ok: true });
}
