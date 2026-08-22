import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireAuth, requireRole } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { validateSupplierCode } from "@/lib/supplier-code";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  defaultCategory: z
    .enum(["COGS", "SERVICES_EXPENSE", "OPERATING_EXPENSE", "OTHER"])
    .or(z.literal(""))
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v ?? null)),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankRouting: z.string().optional(),
  zelle: z.string().optional(),
  paymentInstructions: z.string().optional(),
  // Admin-only fields (enforced below, not by this schema) -- the short
  // code that builds an invoice line's printed item code, whether the
  // supplier is still selectable on new invoice lines, and the special
  // in-stock/HOUSE flag. See the Supplier model's doc comments.
  code: z.string().optional().nullable(),
  active: z.boolean().optional(),
  isHouse: z.boolean().optional(),
});

export async function GET() {
  // Any authenticated role can list suppliers -- the "Create Bill" flow
  // (open to every role) needs a supplier picker, and the Suppliers nav
  // item's role gate (ADMIN/MANAGER only) already keeps the full
  // management page away from SALES. But bank account/routing/Zelle
  // details are compensation-adjacent secrets, not contact info -- strip
  // those unless the caller is ADMIN/MANAGER, same as employees'
  // commissionRate.
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  const canSeeBankDetails = guard.user.role === "ADMIN" || guard.user.role === "MANAGER";

  await initializeDatabase();
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { invoices: true } },
      },
    });
    if (canSeeBankDetails) return NextResponse.json(suppliers);
    const scrubbed = suppliers.map(
      ({ bankName: _bn, bankAccountNumber: _ban, bankRouting: _br, zelle: _z, paymentInstructions: _pi, ...rest }) => rest
    );
    return NextResponse.json(scrubbed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireRole("ADMIN", "MANAGER");
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

  // code/active/isHouse are admin-only -- a MANAGER can still create a
  // supplier's contact/payment info (same as before this feature), but
  // assigning the code that feeds the purchasing trigger's printed item
  // code is deliberately gated tighter.
  if (
    (parsed.data.code !== undefined || parsed.data.active !== undefined || parsed.data.isHouse !== undefined) &&
    guard.user.role !== "ADMIN"
  ) {
    return NextResponse.json(
      { error: "Only an admin can assign a supplier code, active flag, or House designation." },
      { status: 403 }
    );
  }

  const isHouse = parsed.data.isHouse ?? false;
  const codeResult = validateSupplierCode(parsed.data.code, isHouse);
  if ("error" in codeResult) {
    return NextResponse.json({ error: codeResult.error }, { status: 400 });
  }

  await initializeDatabase();
  try {
    const supplier = await prisma.supplier.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        address: parsed.data.address || null,
        paymentTermsDays: parsed.data.paymentTermsDays,
        defaultCategory: parsed.data.defaultCategory ?? null,
        bankName: parsed.data.bankName || null,
        bankAccountNumber: parsed.data.bankAccountNumber || null,
        bankRouting: parsed.data.bankRouting || null,
        zelle: parsed.data.zelle || null,
        paymentInstructions: parsed.data.paymentInstructions || null,
        code: codeResult.code,
        active: parsed.data.active ?? true,
        isHouse,
      },
    });

    await writeAuditLog({
      ...actorFromSession(guard),
      action: "CREATE",
      entityType: "supplier",
      entityId: supplier.id,
      entityLabel: supplier.name,
      ...extractMeta(request),
    });

    return NextResponse.json(supplier, { status: 201 });
  } catch (err) {
    // The DB's own unique constraint on Supplier.code is the real guard
    // against a collision (two admins racing to pick the same code) --
    // surfaced as a clean 409 instead of an unhandled 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: `Code "${codeResult.code}" is already in use by another supplier.` },
        { status: 409 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[suppliers POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
