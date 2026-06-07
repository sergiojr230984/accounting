import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireAuth, requireRole } from "@/lib/api";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  creditCardFeeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  creditCardFeeLabel: z.string().optional(),
});

async function getOrCreateProfile() {
  let profile = await prisma.companyProfile.findUnique({ where: { id: "default" } });
  if (!profile) {
    profile = await prisma.companyProfile.create({ data: { id: "default" } });
  }
  return profile;
}

export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  await initializeDatabase();
  try {
    const profile = await getOrCreateProfile();
    return NextResponse.json(profile, {
      // Short private cache — profile rarely changes during a session.
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

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

  await initializeDatabase();
  await getOrCreateProfile();

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name || null;
  if (parsed.data.logo !== undefined) data.logo = parsed.data.logo || null;
  if (parsed.data.address !== undefined) data.address = parsed.data.address || null;
  if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone || null;
  if (parsed.data.creditCardFeeRate !== undefined) data.creditCardFeeRate = parsed.data.creditCardFeeRate;
  if (parsed.data.creditCardFeeLabel !== undefined) data.creditCardFeeLabel = parsed.data.creditCardFeeLabel || "Credit card processing fee";

  const profile = await prisma.companyProfile.update({ where: { id: "default" }, data });
  return NextResponse.json(profile);
}
