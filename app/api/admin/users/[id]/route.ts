import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { z } from "zod";
import bcrypt from "bcryptjs";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "MANAGER", "SALES"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(session)) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "users", entityLabel: "Update User", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const actorId = session.user?.id;

  // Users cannot change their own role
  if (actorId === id) {
    const body = await request.json();
    if ("role" in body) {
      return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
    }
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Guard: must always keep at least one active Admin
  if ((parsed.data.role && parsed.data.role !== "ADMIN" && existing.role === "ADMIN") ||
      (parsed.data.active === false && existing.role === "ADMIN")) {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot demote or disable the last active Admin" },
        { status: 400 }
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name) updateData.name = parsed.data.name;
  if (parsed.data.role) updateData.role = parsed.data.role;
  if (parsed.data.active !== undefined) updateData.active = parsed.data.active;
  if (parsed.data.password) updateData.password = await bcrypt.hash(parsed.data.password, 12);

  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
    select: { id: true, name: true, email: true, role: true, active: true },
  });

  const action = parsed.data.role && parsed.data.role !== existing.role
    ? "ROLE_CHANGE"
    : "UPDATE";

  await writeAuditLog({
    ...actorFromSession(session),
    action,
    entityType: "user",
    entityId: id,
    entityLabel: `${updated.name} (${updated.email})`,
    changes: {
      ...(parsed.data.role && parsed.data.role !== existing.role
        ? { role: { old: existing.role, new: parsed.data.role } }
        : {}),
      ...(parsed.data.active !== undefined && parsed.data.active !== existing.active
        ? { active: { old: existing.active, new: parsed.data.active } }
        : {}),
    },
    ...extractMeta(request),
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (session.user?.id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (adminCount <= 1) {
      return NextResponse.json({ error: "Cannot delete the last Admin" }, { status: 400 });
    }
  }

  // Soft-delete: disable instead of hard delete to preserve audit history
  const updated = await prisma.user.update({
    where: { id },
    data: { active: false },
    select: { id: true, name: true, email: true },
  });

  await writeAuditLog({
    ...actorFromSession(session),
    action: "DELETE",
    entityType: "user",
    entityId: id,
    entityLabel: `${updated.name} (${updated.email}) — disabled`,
    ...extractMeta(request),
  });

  return NextResponse.json({ ok: true });
}
