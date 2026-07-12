import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireRole } from "@/lib/api";
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
});

export async function GET() {
  // Suppliers include bank account/routing/Zelle details -- ADMIN/MANAGER
  // only, matching every other financial resource in the app.
  const guard = await requireRole("ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;

  await initializeDatabase();
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { invoices: true } },
      },
    });
    return NextResponse.json(suppliers);
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
      },
    });
    return NextResponse.json(supplier, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[suppliers POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
