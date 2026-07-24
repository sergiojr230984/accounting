import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireRole } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["ADMIN", "MANAGER", "SALES"]).default("MANAGER"),
});

export async function GET() {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;
  await initializeDatabase();
  try {
    const users = await prisma.user.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        lastLogin: true,
        createdAt: true,
      },
    });
    return NextResponse.json(users);
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
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await initializeDatabase();
  try {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase().trim(),
        password: hash,
        role: parsed.data.role,
      },
      select: { id: true, name: true, email: true, role: true, active: true, lastLogin: true, createdAt: true },
    });

    await writeAuditLog({
      ...actorFromSession(guard),
      action: "CREATE",
      entityType: "user",
      entityId: user.id,
      entityLabel: `${user.name} (${user.email})`,
      ...extractMeta(request),
    });

    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Unique") || msg.includes("unique")) {
      return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
