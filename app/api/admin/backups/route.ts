import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { runBackup, getBackupDir, pruneOldBackups } from "@/lib/backup";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(session)) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "backups", entityLabel: "Backup List", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const logs = await prisma.backupLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  const lastSuccess = logs.find((l) => l.status === "SUCCESS");

  return NextResponse.json({ logs, lastSuccess: lastSuccess ?? null });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(session)) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "backups", entityLabel: "Run Backup", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const isRestore = body?.action === "restore";

  if (isRestore) {
    // Restore requires explicit confirmation token
    if (body?.confirm !== "RESTORE") {
      return NextResponse.json({ error: "Type RESTORE to confirm" }, { status: 400 });
    }

    await writeAuditLog({
      ...actorFromSession(session),
      action: "BACKUP_RESTORE",
      entityType: "backups",
      entityLabel: `Restore from ${body?.location ?? "unknown"}`,
      ...extractMeta(request),
    });

    // Restore logic: in a real deployment this would import the backup file.
    // The procedure is documented in SETUP.md.
    return NextResponse.json({ ok: true, message: "Restore logged. See SETUP.md for the manual restore procedure." });
  }

  // Run a manual backup
  const logEntry = await prisma.backupLog.create({
    data: {
      status: "RUNNING",
      type: "MANUAL",
      triggeredById: session.user?.id ?? null,
    },
  });

  try {
    const dir = getBackupDir();
    const result = await runBackup(dir);
    await pruneOldBackups(dir);

    const finished = await prisma.backupLog.update({
      where: { id: logEntry.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        sizeBytes: BigInt(result.sizeBytes),
        location: result.location,
      },
    });

    await writeAuditLog({
      ...actorFromSession(session),
      action: "BACKUP_RUN",
      entityType: "backups",
      entityLabel: `Manual backup — ${(result.sizeBytes / 1024).toFixed(1)} KB`,
      ...extractMeta(request),
    });

    return NextResponse.json({ ok: true, backup: finished });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.backupLog.update({
      where: { id: logEntry.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    console.error("[backup] Manual backup failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
