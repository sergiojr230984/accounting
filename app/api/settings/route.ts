import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { z } from "zod";

const customFeeSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  rate: z.number().min(0).max(1), // decimal — 0.05 = 5%
});

const updateSchema = z.object({
  name: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  creditCardFeeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  creditCardFeeLabel: z.string().optional(),
  customFees: z.array(customFeeSchema).optional(),
  customerInvoicePrefix: z.string().optional(),
  customerInvoiceNextSeq: z.number().int().min(0).optional(),
  supplierInvoicePrefix: z.string().optional(),
  supplierInvoiceNextSeq: z.number().int().min(0).optional(),
});

async function getOrCreateProfile() {
  let profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  if (!profile) {
    profile = await prisma.companyProfile.create({ data: { id: "default" } });
  }
  return profile;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getOrCreateProfile();
  return NextResponse.json(profile);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await getOrCreateProfile();

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name || null;
  if (parsed.data.logo !== undefined) data.logo = parsed.data.logo || null;
  if (parsed.data.address !== undefined) data.address = parsed.data.address || null;
  if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone || null;
  if (parsed.data.creditCardFeeRate !== undefined) data.creditCardFeeRate = parsed.data.creditCardFeeRate;
  if (parsed.data.creditCardFeeLabel !== undefined) data.creditCardFeeLabel = parsed.data.creditCardFeeLabel || "Credit card processing fee";
  if (parsed.data.customFees !== undefined) data.customFees = parsed.data.customFees;
  if (parsed.data.customerInvoicePrefix !== undefined) data.customerInvoicePrefix = parsed.data.customerInvoicePrefix;
  if (parsed.data.customerInvoiceNextSeq !== undefined) data.customerInvoiceNextSeq = parsed.data.customerInvoiceNextSeq;
  if (parsed.data.supplierInvoicePrefix !== undefined) data.supplierInvoicePrefix = parsed.data.supplierInvoicePrefix;
  if (parsed.data.supplierInvoiceNextSeq !== undefined) data.supplierInvoiceNextSeq = parsed.data.supplierInvoiceNextSeq;

  const profile = await prisma.companyProfile.update({ where: { id: "default" }, data });
  return NextResponse.json(profile);
}
