import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { gzipSync } from "zlib";

export interface BackupResult {
  location: string;
  sizeBytes: number;
  tableCount: number;
  fileCount: number;
}

/** Exports all DB tables via Prisma and writes a gzipped JSON file. */
export async function runBackup(backupDir: string): Promise<BackupResult> {
  await fs.promises.mkdir(backupDir, { recursive: true });

  const [
    users,
    customers,
    suppliers,
    customerInvoices,
    customerInvoiceItems,
    supplierInvoices,
    supplierInvoiceItems,
    payments,
    uploadedFiles,
    auditLogs,
    leads,
    leadMessages,
    leadAssignments,
    crmSettings,
  ] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    }),
    prisma.customer.findMany(),
    prisma.supplier.findMany(),
    prisma.customerInvoice.findMany(),
    prisma.customerInvoiceItem.findMany(),
    prisma.supplierInvoice.findMany(),
    prisma.supplierInvoiceItem.findMany(),
    prisma.payment.findMany(),
    prisma.uploadedFile.findMany(),
    prisma.auditLog.findMany({ orderBy: { timestamp: "asc" } }),
    prisma.lead.findMany(),
    prisma.leadMessage.findMany(),
    prisma.leadAssignment.findMany(),
    prisma.crmSetting.findMany(),
  ]);

  const payload = {
    meta: {
      timestamp: new Date().toISOString(),
      appVersion: process.env.npm_package_version ?? "unknown",
      tables: [
        "users", "customers", "suppliers",
        "customerInvoices", "customerInvoiceItems",
        "supplierInvoices", "supplierInvoiceItems",
        "payments", "uploadedFiles", "auditLogs",
        "leads", "leadMessages", "leadAssignments", "crmSettings",
      ],
      fileCount: uploadedFiles.length,
    },
    data: {
      users, customers, suppliers,
      customerInvoices, customerInvoiceItems,
      supplierInvoices, supplierInvoiceItems,
      payments, uploadedFiles, auditLogs,
      leads, leadMessages, leadAssignments, crmSettings,
    },
  };

  const json = JSON.stringify(payload, null, 2);
  const compressed = gzipSync(Buffer.from(json, "utf8"));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${timestamp}.json.gz`;
  const filePath = path.join(backupDir, filename);

  await fs.promises.writeFile(filePath, compressed);

  // Optional: upload to S3-compatible storage if credentials are configured
  await maybeUploadToS3(filePath, filename);

  return {
    location: filePath,
    sizeBytes: compressed.length,
    tableCount: payload.meta.tables.length,
    fileCount: uploadedFiles.length,
  };
}

async function maybeUploadToS3(localPath: string, key: string): Promise<void> {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const accessKey = process.env.BACKUP_S3_ACCESS_KEY;
  const secretKey = process.env.BACKUP_S3_SECRET_KEY;

  if (!bucket || !endpoint || !accessKey || !secretKey) return;

  // Dynamic import so the build doesn't fail if the AWS SDK isn't installed
  try {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      endpoint,
      region: process.env.BACKUP_S3_REGION ?? "us-east-1",
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true,
    });
    const body = await fs.promises.readFile(localPath);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/gzip" }));
    console.log(`[backup] Uploaded ${key} to s3://${bucket}`);
  } catch (err) {
    console.error("[backup] S3 upload failed:", err);
  }
}

export function getBackupDir(): string {
  return process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");
}

/** Pruning rules: daily → 30 days, weekly → 12 weeks, monthly → 12 months. */
export async function pruneOldBackups(backupDir: string): Promise<number> {
  let pruned = 0;
  try {
    const files = await fs.promises.readdir(backupDir);
    const backupFiles = files
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json.gz"))
      .map((f) => ({
        name: f,
        path: path.join(backupDir, f),
        // Parse date from filename: backup-2024-01-15T10-30-00-000Z.json.gz
        date: new Date(f.replace("backup-", "").replace(".json.gz", "").replace(/-(?=\d{2}-\d{2}-)/g, ":").replace(/T(\d{2})-(\d{2})-(\d{2})-/, "T$1:$2:$3.")),
      }))
      .filter((f) => !isNaN(f.date.getTime()))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const now = Date.now();
    const keep = new Set<string>();

    // Keep all from last 30 days
    for (const f of backupFiles) {
      if (now - f.date.getTime() <= 30 * 24 * 60 * 60 * 1000) keep.add(f.name);
    }
    // Keep one per week for last 12 weeks
    const weeklyKept = new Set<string>();
    for (const f of backupFiles) {
      const weekKey = Math.floor(f.date.getTime() / (7 * 24 * 60 * 60 * 1000));
      const weeksAgo = (now - f.date.getTime()) / (7 * 24 * 60 * 60 * 1000);
      if (weeksAgo <= 12 && !weeklyKept.has(String(weekKey))) {
        keep.add(f.name);
        weeklyKept.add(String(weekKey));
      }
    }
    // Keep one per month for last 12 months
    const monthlyKept = new Set<string>();
    for (const f of backupFiles) {
      const monthKey = `${f.date.getFullYear()}-${f.date.getMonth()}`;
      const monthsAgo = (now - f.date.getTime()) / (30 * 24 * 60 * 60 * 1000);
      if (monthsAgo <= 12 && !monthlyKept.has(monthKey)) {
        keep.add(f.name);
        monthlyKept.add(monthKey);
      }
    }

    for (const f of backupFiles) {
      if (!keep.has(f.name)) {
        await fs.promises.unlink(f.path);
        pruned++;
      }
    }
  } catch (err) {
    console.error("[backup] Pruning error:", err);
  }
  return pruned;
}
