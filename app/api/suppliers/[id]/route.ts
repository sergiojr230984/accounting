import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession, diffChanges } from "@/lib/audit";
import { validateSupplierCode } from "@/lib/supplier-code";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")).or(z.null()),
  phone: z.string().optional().or(z.null()),
  address: z.string().optional().or(z.null()),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  defaultCategory: z
    .enum(["COGS", "SERVICES_EXPENSE", "OPERATING_EXPENSE", "OTHER"])
    .or(z.literal(""))
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v ?? null)),
  bankName: z.string().optional().or(z.null()),
  bankAccountNumber: z.string().optional().or(z.null()),
  bankRouting: z.string().optional().or(z.null()),
  zelle: z.string().optional().or(z.null()),
  paymentInstructions: z.string().optional().or(z.null()),
  // Admin-only -- see the POST route's matching comment.
  code: z.string().optional().nullable(),
  active: z.boolean().optional(),
  isHouse: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // code/active/isHouse are admin-only -- see the create route's matching
  // comment.
  if (
    (parsed.data.code !== undefined || parsed.data.active !== undefined || parsed.data.isHouse !== undefined) &&
    guard.user.role !== "ADMIN"
  ) {
    return NextResponse.json(
      { error: "Only an admin can change a supplier code, active flag, or House designation." },
      { status: 403 }
    );
  }

  const data: Record<string, unknown> = {
    name: parsed.data.name,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    address: parsed.data.address || null,
  };
  if (parsed.data.paymentTermsDays !== undefined) data.paymentTermsDays = parsed.data.paymentTermsDays;
  if (parsed.data.defaultCategory !== undefined) data.defaultCategory = parsed.data.defaultCategory ?? null;
  if (parsed.data.bankName !== undefined) data.bankName = parsed.data.bankName || null;
  if (parsed.data.bankAccountNumber !== undefined) data.bankAccountNumber = parsed.data.bankAccountNumber || null;
  if (parsed.data.bankRouting !== undefined) data.bankRouting = parsed.data.bankRouting || null;
  if (parsed.data.zelle !== undefined) data.zelle = parsed.data.zelle || null;
  if (parsed.data.paymentInstructions !== undefined) data.paymentInstructions = parsed.data.paymentInstructions || null;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (parsed.data.isHouse !== undefined) data.isHouse = parsed.data.isHouse;

  let codeResult: { code: string | null } | null = null;
  if (parsed.data.code !== undefined) {
    // isHouse might not be part of *this* PATCH -- fall back to the
    // existing row's value so an admin editing just the code on an
    // already-HOUSE supplier still gets the 2-4 letter rule, not the
    // stricter 2-letter one.
    const effectiveIsHouse = parsed.data.isHouse ?? existing.isHouse;
    const result = validateSupplierCode(parsed.data.code, effectiveIsHouse);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    codeResult = result;
    data.code = result.code;
  }

  let supplier;
  try {
    supplier = await prisma.supplier.update({ where: { id }, data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: `Code "${codeResult?.code}" is already in use by another supplier.` },
        { status: 409 }
      );
    }
    throw err;
  }

  await writeAuditLog({
    ...actorFromSession(guard),
    action: "UPDATE",
    entityType: "supplier",
    entityId: id,
    entityLabel: supplier.name,
    changes: diffChanges(
      { name: existing.name, email: existing.email, phone: existing.phone, address: existing.address, code: existing.code, active: existing.active, isHouse: existing.isHouse },
      { name: supplier.name, email: supplier.email, phone: supplier.phone, address: supplier.address, code: supplier.code, active: supplier.active, isHouse: supplier.isHouse }
    ),
    ...extractMeta(request),
  });

  return NextResponse.json(supplier);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;

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
    ...actorFromSession(guard),
    action: "DELETE",
    entityType: "supplier",
    entityId: id,
    entityLabel: existing.name,
    ...extractMeta(request),
  });

  return NextResponse.json({ ok: true });
}
