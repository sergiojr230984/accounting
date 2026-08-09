import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Deactivate rather than delete the row -- keeps a durable record (label,
  // who created it, when) of what existed and was revoked, matching the
  // "lock, don't delete" convention already used for the product catalog.
  await prisma.apiKey.update({ where: { id }, data: { active: false } });

  await writeAuditLog({
    ...actorFromSession(guard),
    action: "DELETE",
    entityType: "api_key",
    entityId: id,
    entityLabel: `API key "${existing.label}"`,
    ...extractMeta(request),
  });

  return NextResponse.json({ ok: true });
}
