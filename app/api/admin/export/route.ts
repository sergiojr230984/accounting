import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { runBackup, getBackupDir } from "@/lib/backup";
import fs from "fs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(session)) {
    await writeAuditLog({ ...actorFromSession(session), action: "ACCESS_DENIED", entityType: "backups", entityLabel: "Data Export", ...extractMeta(request) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const dir = getBackupDir();
    const result = await runBackup(dir);
    const fileBuffer = await fs.promises.readFile(result.location);

    await writeAuditLog({
      ...actorFromSession(session),
      action: "EXPORT",
      entityType: "backups",
      entityLabel: `Full data export — ${(result.sizeBytes / 1024).toFixed(1)} KB`,
      ...extractMeta(request),
    });

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="la-cuevita-export-${new Date().toISOString().slice(0, 10)}.json.gz"`,
        "Content-Length": String(result.sizeBytes),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
