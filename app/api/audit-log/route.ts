import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";

export async function GET(request: Request) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const actorUserId = searchParams.get("userId");
  const action = searchParams.get("action");
  const entityType = searchParams.get("entityType");
  const search = searchParams.get("search");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50"));
  const exportCsv = searchParams.get("export") === "csv";

  const where: Record<string, unknown> = {};
  if (from || to) {
    where.timestamp = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (actorUserId) where.actorUserId = actorUserId;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (search) where.entityLabel = { contains: search, mode: "insensitive" };

  if (exportCsv) {
    const logs = await prisma.auditLog.findMany({ where, orderBy: { timestamp: "desc" } });

    await writeAuditLog({
      ...actorFromSession(guard),
      action: "CREATE",
      entityType: "audit_log",
      entityLabel: "Audit Log CSV Export",
      ...extractMeta(request),
    });

    const header = "id,timestamp,actorName,actorRole,action,entityType,entityId,entityLabel,ipAddress\n";
    const rows = logs
      .map((l) =>
        [
          l.id,
          l.timestamp.toISOString(),
          `"${l.actorName.replace(/"/g, '""')}"`,
          l.actorRole,
          l.action,
          l.entityType,
          l.entityId ?? "",
          `"${l.entityLabel.replace(/"/g, '""')}"`,
          l.ipAddress,
        ].join(",")
      )
      .join("\n");

    return new Response(header + rows, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, limit });
}
