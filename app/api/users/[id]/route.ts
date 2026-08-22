import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession, diffChanges } from "@/lib/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["ADMIN", "MANAGER", "SALES"]).optional(),
  active: z.boolean().optional(),
});

async function lastActiveAdminCheck(targetId: string, willStillBeAdmin: boolean, willStillBeActive: boolean) {
  // If the user being updated would remain an active admin, we're fine.
  if (willStillBeAdmin && willStillBeActive) return null;
  const otherActiveAdmins = await prisma.user.count({
    where: { role: "ADMIN", active: true, NOT: { id: targetId } },
  });
  if (otherActiveAdmins === 0) {
    return "Refusing — this is the last active admin. Promote or activate another admin first.";
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Safety: can't demote / deactivate yourself.
  if (target.id === guard.user.id) {
    if (parsed.data.role && parsed.data.role !== "ADMIN") {
      return NextResponse.json({ error: "You cannot demote yourself. Ask another admin." }, { status: 400 });
    }
    if (parsed.data.active === false) {
      return NextResponse.json({ error: "You cannot deactivate yourself." }, { status: 400 });
    }
  }

  // Safety: don't lock yourself out of the system entirely.
  if (target.role === "ADMIN" && (parsed.data.role === "MANAGER" || parsed.data.role === "SALES" || parsed.data.active === false)) {
    const willBeAdmin = parsed.data.role ? parsed.data.role === "ADMIN" : target.role === "ADMIN";
    const willBeActive = parsed.data.active === undefined ? target.active : parsed.data.active;
    const err = await lastActiveAdminCheck(target.id, willBeAdmin, willBeActive);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.email !== undefined) data.email = parsed.data.email.toLowerCase().trim();
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (parsed.data.password !== undefined) data.password = await bcrypt.hash(parsed.data.password, 12);

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, active: true, lastLogin: true, createdAt: true },
    });

    await writeAuditLog({
      ...actorFromSession(guard),
      action: parsed.data.role !== undefined && parsed.data.role !== target.role ? "ROLE_CHANGE" : "UPDATE",
      entityType: "user",
      entityId: id,
      entityLabel: `${user.name} (${user.email})`,
      changes: diffChanges(
        { name: target.name, email: target.email, role: target.role, active: target.active },
        { name: user.name, email: user.email, role: user.role, active: user.active }
      ),
      ...extractMeta(request),
    });

    return NextResponse.json(user);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Unique") || msg.includes("unique")) {
      return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  if (id === guard.user.id) {
    return NextResponse.json({ error: "You cannot delete yourself." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (target.role === "ADMIN") {
    const err = await lastActiveAdminCheck(target.id, false, false);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // Soft-delete-ish: deactivate instead of hard delete so historical FK refs stay intact.
  await prisma.user.update({ where: { id }, data: { active: false } });

  await writeAuditLog({
    ...actorFromSession(guard),
    action: "DELETE",
    entityType: "user",
    entityId: id,
    entityLabel: `${target.name} (${target.email})`,
    ...extractMeta(request),
  });

  return NextResponse.json({ ok: true, deactivated: true });
}
