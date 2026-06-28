import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runBackup, getBackupDir, pruneOldBackups } from "@/lib/backup";

// Called by an external scheduler (e.g. Railway cron, GitHub Actions, Vercel Cron).
// Protect with a shared secret so only the scheduler can trigger it.
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.BACKUP_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logEntry = await prisma.backupLog.create({
    data: { status: "RUNNING", type: "SCHEDULED" },
  });

  try {
    const dir = getBackupDir();
    const result = await runBackup(dir);
    await pruneOldBackups(dir);

    await prisma.backupLog.update({
      where: { id: logEntry.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        sizeBytes: BigInt(result.sizeBytes),
        location: result.location,
      },
    });

    console.log(`[backup/cron] Scheduled backup SUCCESS — ${result.sizeBytes} bytes`);
    return NextResponse.json({ ok: true, sizeBytes: result.sizeBytes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.backupLog.update({
      where: { id: logEntry.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });

    // Email alert on failure
    await sendFailureAlert(message);

    console.error("[backup/cron] Scheduled backup FAILED:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function sendFailureAlert(message: string): Promise<void> {
  const alertEmail = process.env.BACKUP_ALERT_EMAIL;
  const smtpHost = process.env.SMTP_HOST;
  if (!alertEmail || !smtpHost) return;

  try {
    // Dynamic import — nodemailer is optional; add to dependencies if SMTP is needed
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: alertEmail,
      subject: "[La Cuevita] Scheduled backup FAILED",
      text: `The automated daily backup failed at ${new Date().toISOString()}.\n\nError:\n${message}\n\nCheck the Backups page in the Admin area.`,
    });
  } catch (e) {
    console.error("[backup] Failed to send alert email:", e);
  }
}
