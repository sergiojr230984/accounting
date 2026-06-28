import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(session)) {
    await writeAuditLog({
      ...actorFromSession(session),
      action: "ACCESS_DENIED",
      entityType: "audit_log",
      entityLabel: "Audit Log",
      ...extractMeta(request),
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const userId = searchParams.get("userId");
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
  if (userId) where.actorUserId = userId;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (search) where.entityLabel = { contains: search, mode: "insensitive" };

  if (exportCsv) {
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    await writeAuditLog({
      ...actorFromSession(session),
      action: "EXPORT",
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
