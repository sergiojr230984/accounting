import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/csv",
  "application/vnd.ms-excel",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? "./public/uploads";
}

export async function ensureUploadDir() {
  const dir = getUploadDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function validateFile(file: File): { ok: boolean; error?: string } {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { ok: false, error: "File type not allowed. Use PDF, JPG, PNG, or CSV." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, error: "File too large. Maximum 10MB." };
  }
  return { ok: true };
}

export async function saveFile(
  file: File
): Promise<{ storedName: string; filePath: string }> {
  const dir = await ensureUploadDir();
  const ext = path.extname(file.name);
  const storedName = `${randomUUID()}${ext}`;
  const filePath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  return { storedName, filePath };
}

export async function deleteFile(storedName: string) {
  const dir = getUploadDir();
  const filePath = path.join(dir, storedName);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may already be gone
  }
}
